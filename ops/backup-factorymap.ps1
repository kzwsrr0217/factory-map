<#
.SYNOPSIS
  Backs up the factorymap database out of the MSSQL container to a dated file.

.DESCRIPTION
  Why this exists: part of what the app holds cannot be re-imported from
  anywhere. The ITSM snapshot can be re-exported from Alemba, but the zones,
  the work-area rectangles, the socket labels and every manual placement were
  entered by hand. One VM failure without a backup means redoing that work.

  What it does:
    1. BACKUP DATABASE inside the container (to the mssql_data volume).
    2. Copies the .bak out to -Destination on the host, named with the date.
    3. Deletes the in-container copy, so the volume does not grow every night.
    4. Verifies the host file exists and is non-empty, and exits non-zero if
       not - a scheduled task that "succeeds" while producing nothing is worse
       than no task at all.
    5. Prunes host backups older than -KeepDays.

  The password is read from the .env.prod file that the deployment already
  uses, so it is not duplicated into this script, into the scheduled task's
  arguments, or into the log.

  NOTE: deliberately ASCII-only. Windows PowerShell 5.1 reads .ps1 files as
  ANSI unless they carry a UTF-8 BOM, so any accented or box-drawing character
  in here would break parsing on the VM depending on how the file was saved.

.PARAMETER EnvFile
  Path to the deployment's .env.prod. Used only to read MSSQL_PASSWORD.

.PARAMETER Destination
  Host directory for the .bak files. Created if missing.

.PARAMETER KeepDays
  Delete host backups older than this many days. Default 14.

.EXAMPLE
  .\backup-factorymap.ps1 -EnvFile C:\factorymap\.env.prod -Destination D:\backups\factorymap

.NOTES
  Scheduled-task caveat: podman on Windows runs inside the user's WSL2 session,
  so `podman exec` only works while that session exists. Register the task to
  run as the same account with "Run only when user is logged on", or make the
  podman machine start at boot - otherwise the task will fail every night with
  a connection error. See docs/DEPLOYMENT.md.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $EnvFile,
  [Parameter(Mandatory = $true)] [string] $Destination,
  [int] $KeepDays = 14,
  [string] $Container = 'factory-map-mssql',
  [string] $Database = 'factorymap',
  [string] $PodmanExe = 'podman'
)

$ErrorActionPreference = 'Stop'

function Write-Log([string] $Message) {
  Write-Output ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

<#
  Runs an external command and returns its exit code, without letting anything
  it writes to stderr become a PowerShell error.

  Needed because $ErrorActionPreference = 'Stop' turns a native command's stderr
  output into a terminating NativeCommandError *before* the caller can look at
  $LASTEXITCODE - so `sqlcmd: login failed` would surface as an unreadable
  RemoteException stack instead of this script's own message. Setting the
  preference back to Continue for the duration of the call is the standard way
  around it.

  Output is captured and discarded rather than echoed: sqlcmd's error text can
  repeat the connection arguments, and this script's whole point is to keep the
  password out of a log that runs nightly and unattended.
#>
function Invoke-Native {
  param([Parameter(Mandatory = $true)] [string[]] $CommandLine)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $CommandLine[0] @($CommandLine[1..($CommandLine.Length - 1)]) 2>&1 | Out-Null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

# Everything below runs inside a try so that any failure exits non-zero, which
# is what Task Scheduler's "Last Run Result" reports. A nightly job that fails
# silently with code 0 is the failure mode this whole script exists to avoid.
try {

  # --- Read the password out of the existing .env.prod -----------------------
  if (-not (Test-Path $EnvFile)) { throw "Env file not found: $EnvFile" }
  $password = $null
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match '^\s*MSSQL_PASSWORD\s*=\s*(.+?)\s*$') {
      # Strip optional surrounding quotes; .env files allow either form.
      $password = $Matches[1].Trim("'").Trim('"')
    }
  }
  if ([string]::IsNullOrWhiteSpace($password)) {
    throw "MSSQL_PASSWORD not found in $EnvFile"
  }

  $stamp       = Get-Date -Format 'yyyyMMdd-HHmmss'
  $inContainer = "/var/opt/mssql/data/$Database-$stamp.bak"
  $hostFile    = Join-Path $Destination "$Database-$stamp.bak"

  if (-not (Test-Path $Destination)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Write-Log "Created $Destination"
  }

  # --- 1. Back up inside the container --------------------------------------
  # COPY_ONLY so this never interferes with any other backup chain; CHECKSUM so
  # a corrupt page is caught here rather than discovered during a restore.
  # Compression is deliberately not requested: SQL Server Express does not
  # support it and would fail the whole command.
  $sql = "BACKUP DATABASE [$Database] TO DISK = N'$inContainer' WITH COPY_ONLY, INIT, CHECKSUM, STATS = 50"

  Write-Log "Backing up $Database inside $Container ..."
  $code = Invoke-Native @($PodmanExe, 'exec', $Container, '/opt/mssql-tools18/bin/sqlcmd',
                          '-S', 'localhost', '-U', 'sa', '-P', $password, '-No', '-Q', $sql)
  if ($code -ne 0) {
    throw "BACKUP DATABASE failed (sqlcmd exit $code). Run it by hand to see the server error."
  }
  Write-Log "Backup written inside the container."

  # --- 2. Copy it out -------------------------------------------------------
  Write-Log "Copying to $hostFile ..."
  $code = Invoke-Native @($PodmanExe, 'cp', "${Container}:$inContainer", $hostFile)
  if ($code -ne 0) { throw "podman cp failed (exit $code)" }

  # --- 3. Remove the in-container copy --------------------------------------
  # Best-effort: a leftover file wastes volume space but does not invalidate the
  # backup already copied out, so its exit code is ignored on purpose.
  Invoke-Native @($PodmanExe, 'exec', $Container, 'rm', '-f', $inContainer) | Out-Null

  # --- 4. Verify ------------------------------------------------------------
  if (-not (Test-Path $hostFile)) { throw "Backup file missing after copy: $hostFile" }
  $size = (Get-Item $hostFile).Length
  if ($size -lt 1MB) { throw "Backup file suspiciously small ($size bytes): $hostFile" }
  Write-Log ("OK - {0} ({1:N1} MB)" -f $hostFile, ($size / 1MB))

  # --- 5. Prune -------------------------------------------------------------
  # Only after a verified good backup, so a failing run never deletes the last
  # known-good file.
  $cutoff = (Get-Date).AddDays(-$KeepDays)
  $old = @(Get-ChildItem -LiteralPath $Destination -Filter "$Database-*.bak" |
           Where-Object { $_.LastWriteTime -lt $cutoff })
  foreach ($f in $old) {
    Remove-Item -LiteralPath $f.FullName -Force
    Write-Log "Pruned $($f.Name)"
  }
  if ($old.Count -eq 0) { Write-Log "Nothing to prune (keeping $KeepDays days)." }

  Write-Log "Done."
  exit 0
} catch {
  Write-Log ("FAILED: {0}" -f $_.Exception.Message)
  exit 1
}
