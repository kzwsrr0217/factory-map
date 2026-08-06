<#
.SYNOPSIS
  Restores a factorymap .bak into the MSSQL container, over whatever is there now.

.DESCRIPTION
  Why this exists: the deployment guide described this step as "copy the .bak into
  the container, RESTORE DATABASE". That sentence hides four things that go wrong,
  and it is the one step in the whole plan that destroys data:

    1. The app holds the database open. RESTORE cannot take an exclusive lock
       while the backend has a connection pool on it, so it fails - or worse,
       SINGLE_USER is forced and the app reconnects into a half-restored file.
       This stops the backend first and starts it again afterwards.
    2. The logical file names inside the .bak are the SOURCE server's, and the
       paths in it are the source container's. Restoring without MOVE either
       fails or writes into a path that happens to exist. The names are read out
       of the backup itself with FILELISTONLY rather than assumed.
    3. Whatever is in the target database right now is gone afterwards. So a
       safety backup of the target is taken first, unless explicitly skipped,
       and the script says where it put it.
    4. The restored database carries the SOURCE's migration history. Development
       never needed one - only 2 of the 13 migrations are recorded there - so
       migration:run on the target would try to apply eleven deltas the schema
       already has. This does not guess: it reports what is recorded and points
       at `npm run verify:migrations`, which computes the exact INSERT.

  The password is read from the .env file the deployment already uses, the same
  way backup-factorymap.ps1 does it, so it is never passed on a command line or
  written into a log.

  NOTE: deliberately ASCII-only. Windows PowerShell 5.1 reads .ps1 files as ANSI
  unless they carry a UTF-8 BOM, so any accented character in here would break
  parsing on the VM depending on how the file was saved.

.PARAMETER EnvFile
  Path to the deployment's .env / .env.prod. Used only to read MSSQL_PASSWORD.

.PARAMETER BakFile
  The .bak to restore, on the host.

.PARAMETER SafetyBackupTo
  Host directory for the safety backup of the database being overwritten.
  Required unless -SkipSafetyBackup.

.PARAMETER SkipSafetyBackup
  Do not back up the target first. Only for a target you are certain is empty.

.PARAMETER DryRun
  Prints every step, including the RESTORE statement it would run, and changes
  nothing.

.EXAMPLE
  .\restore-factorymap.ps1 -EnvFile C:\factorymap\.env.prod `
      -BakFile D:\transfer\factorymap-20260806-101500.bak `
      -SafetyBackupTo D:\backups\factorymap

.EXAMPLE
  .\restore-factorymap.ps1 -EnvFile C:\factorymap\.env.prod `
      -BakFile D:\transfer\factorymap-20260806-101500.bak -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $EnvFile,
  [Parameter(Mandatory = $true)] [string] $BakFile,
  [string] $SafetyBackupTo,
  [switch] $SkipSafetyBackup,
  [switch] $DryRun,
  [string] $Container = 'factory-map-mssql',
  [string] $BackendContainer = 'factory-map-backend',
  [string] $Database = 'factorymap',
  [string] $PodmanExe = 'podman'
)

$ErrorActionPreference = 'Stop'

function Write-Log([string] $Message) {
  Write-Output ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

<#
  Runs an external command and returns its exit code, without letting anything it
  writes to stderr become a PowerShell error. Same reasoning as in
  backup-factorymap.ps1: $ErrorActionPreference = 'Stop' turns a native command's
  stderr into a terminating error before the caller can look at the exit code, and
  sqlcmd writes progress to stderr.
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

# As above, but gives back what the command printed - needed for reading
# FILELISTONLY and the row counts back out of sqlcmd.
function Invoke-NativeCapture {
  param([Parameter(Mandatory = $true)] [string[]] $CommandLine)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $CommandLine[0] @($CommandLine[1..($CommandLine.Length - 1)]) 2>&1
    return @{ Code = $LASTEXITCODE; Output = ($out | Out-String) }
  } finally {
    $ErrorActionPreference = $previous
  }
}

try {
  if (-not (Test-Path $EnvFile)) { throw "Env file not found: $EnvFile" }
  if (-not (Test-Path $BakFile)) { throw "Backup file not found: $BakFile" }
  if (-not $SkipSafetyBackup -and [string]::IsNullOrWhiteSpace($SafetyBackupTo)) {
    throw "Give -SafetyBackupTo (a directory for the backup of what is about to be overwritten), or pass -SkipSafetyBackup if the target is empty."
  }

  $password = $null
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match '^\s*MSSQL_PASSWORD\s*=\s*(.+?)\s*$') {
      $password = $Matches[1].Trim("'").Trim('"')
    }
  }
  if ([string]::IsNullOrWhiteSpace($password)) { throw "MSSQL_PASSWORD not found in $EnvFile" }

  # Runs one statement through sqlcmd in the container. -h -1 strips the column
  # headers and dashes so the output can be read as data.
  function Invoke-Sql([string] $Sql, [switch] $Raw) {
    $args = @($PodmanExe, 'exec', $Container, '/opt/mssql-tools18/bin/sqlcmd',
              '-S', 'localhost', '-U', 'sa', '-P', $password, '-No')
    if ($Raw) { $args += @('-h', '-1', '-W') }
    $args += @('-Q', $Sql)
    return Invoke-NativeCapture $args
  }

  <#
    A one-line summary of what the target database holds. NOCOUNT and the line filter
    are there because sqlcmd interleaves its own chatter ("Changed database context
    to ...", "(1 rows affected)") with the answer, and a status line that reads
    "Changed database context to 'factorymap'. assets=1331" is worse than none.
  #>
  function Get-Counts {
    $sql = "SET NOCOUNT ON; USE [$Database]; SELECT CONCAT('assets=', (SELECT COUNT(*) FROM assets), " +
           "' workareas=', (SELECT COUNT(*) FROM work_areas), " +
           "' users=', (SELECT COUNT(*) FROM users), " +
           "' migrations=', (SELECT COUNT(*) FROM typeorm_migrations))"
    $r = Invoke-Sql $sql -Raw
    $line = @($r.Output -split "`r?`n" | Where-Object { $_ -match 'assets=' }) | Select-Object -First 1
    if ($null -eq $line) { return "could not be read" }
    return $line.Trim()
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $inContainerBak = "/var/opt/mssql/data/restore-$stamp.bak"

  Write-Log ("Restoring {0} into [{1}] on {2}" -f (Split-Path $BakFile -Leaf), $Database, $Container)
  if ($DryRun) { Write-Log "DRY RUN - nothing will be changed." }

  # --- 0. What is there now -------------------------------------------------
  # Reported before anything is destroyed, so the operator can stop if the target
  # is not what they thought it was.
  $exists = Invoke-Sql "SELECT CASE WHEN DB_ID(N'$Database') IS NULL THEN 0 ELSE 1 END" -Raw
  $targetExists = ($exists.Output -match '(?m)^\s*1\s*$')
  if ($targetExists) {
    Write-Log ("Target now holds: {0}" -f (Get-Counts))
  } else {
    Write-Log "Target database does not exist yet - this will create it."
  }

  # --- 1. Safety backup of what is about to go ------------------------------
  if ($targetExists -and -not $SkipSafetyBackup) {
    if (-not (Test-Path $SafetyBackupTo)) {
      if (-not $DryRun) { New-Item -ItemType Directory -Path $SafetyBackupTo -Force | Out-Null }
      Write-Log "Created $SafetyBackupTo"
    }
    $safetyInContainer = "/var/opt/mssql/data/$Database-before-restore-$stamp.bak"
    $safetyHost = Join-Path $SafetyBackupTo "$Database-before-restore-$stamp.bak"
    Write-Log "Safety backup -> $safetyHost"
    if (-not $DryRun) {
      $r = Invoke-Sql "BACKUP DATABASE [$Database] TO DISK = N'$safetyInContainer' WITH COPY_ONLY, INIT, CHECKSUM, STATS = 50"
      if ($r.Code -ne 0) { throw "Safety backup failed, so nothing was restored:`n$($r.Output)" }
      $code = Invoke-Native @($PodmanExe, 'cp', "${Container}:$safetyInContainer", $safetyHost)
      if ($code -ne 0) { throw "Safety backup could not be copied out, so nothing was restored." }
      Invoke-Native @($PodmanExe, 'exec', $Container, 'rm', '-f', $safetyInContainer) | Out-Null
      if (-not (Test-Path $safetyHost)) { throw "Safety backup missing after copy: $safetyHost" }
      $size = (Get-Item $safetyHost).Length
      if ($size -lt 1MB) { throw "Safety backup suspiciously small ($size bytes) - stopping." }
      Write-Log ("Safety backup OK ({0:N1} MB)" -f ($size / 1MB))
    }
  } elseif ($SkipSafetyBackup) {
    Write-Log "Safety backup skipped, as asked."
  }

  # --- 2. Copy the .bak in --------------------------------------------------
  Write-Log "Copying the backup into the container ..."
  if (-not $DryRun) {
    $code = Invoke-Native @($PodmanExe, 'cp', $BakFile, "${Container}:$inContainerBak")
    if ($code -ne 0) { throw "podman cp failed (exit $code)" }
  }

  # --- 3. Read the logical file names out of the backup ---------------------
  # Not assumed: they are the source server's names, and a restore that guesses
  # them either fails or writes somewhere that happens to exist.
  $dataName = 'factorymap'
  $logName  = 'factorymap_log'
  if (-not $DryRun) {
    $list = Invoke-Sql "RESTORE FILELISTONLY FROM DISK = N'$inContainerBak'" -Raw
    if ($list.Code -ne 0) { throw "Could not read the backup - is it a factorymap .bak?`n$($list.Output)" }
    $rows = @($list.Output -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
    foreach ($row in $rows) {
      $fields = @($row -split '\s+' | Where-Object { $_ -ne '' })
      if ($fields.Count -lt 3) { continue }
      if ($fields[2] -eq 'D') { $dataName = $fields[0] }
      if ($fields[2] -eq 'L') { $logName  = $fields[0] }
    }
    Write-Log ("Backup contains data file '{0}' and log file '{1}'" -f $dataName, $logName)
  }

  $restoreSql = "RESTORE DATABASE [$Database] FROM DISK = N'$inContainerBak' WITH REPLACE, RECOVERY, STATS = 10, " +
                "MOVE N'$dataName' TO N'/var/opt/mssql/data/$Database.mdf', " +
                "MOVE N'$logName' TO N'/var/opt/mssql/data/${Database}_log.ldf'"

  # --- 4. Get the app off the database --------------------------------------
  # The backend holds a pool open; RESTORE needs exclusive access. Stopping the
  # container is cleaner than SINGLE_USER, which the app would race to reconnect
  # into.
  $backendWasRunning = $false
  $ps = Invoke-NativeCapture @($PodmanExe, 'ps', '--format', '{{.Names}}')
  if ($ps.Output -match [regex]::Escape($BackendContainer)) { $backendWasRunning = $true }
  if ($backendWasRunning) {
    Write-Log "Stopping $BackendContainer so the restore can take the database exclusively ..."
    if (-not $DryRun) { Invoke-Native @($PodmanExe, 'stop', $BackendContainer) | Out-Null }
  } else {
    Write-Log "$BackendContainer is not running - nothing to stop."
  }

  try {
    # --- 5. Restore ---------------------------------------------------------
    Write-Log "RESTORE:"
    Write-Log ("  {0}" -f $restoreSql)
    if (-not $DryRun) {
      if ($targetExists) {
        # Any other session (a leftover sqlcmd, a management tool) would block it.
        Invoke-Sql "ALTER DATABASE [$Database] SET SINGLE_USER WITH ROLLBACK IMMEDIATE" | Out-Null
      }
      $r = Invoke-Sql $restoreSql
      if ($r.Code -ne 0) {
        # Put the database back into a usable state before reporting, or the app
        # comes back to a database nobody can connect to.
        Invoke-Sql "IF DB_ID(N'$Database') IS NOT NULL ALTER DATABASE [$Database] SET MULTI_USER" | Out-Null
        throw "RESTORE failed:`n$($r.Output)"
      }
      Invoke-Sql "ALTER DATABASE [$Database] SET MULTI_USER" | Out-Null
      Write-Log "Restored."
    }
  } finally {
    Invoke-Native @($PodmanExe, 'exec', $Container, 'rm', '-f', $inContainerBak) | Out-Null
    if ($backendWasRunning) {
      Write-Log "Starting $BackendContainer ..."
      if (-not $DryRun) { Invoke-Native @($PodmanExe, 'start', $BackendContainer) | Out-Null }
    }
  }

  if ($DryRun) {
    Write-Log "DRY RUN complete - nothing was changed."
    exit 0
  }

  # --- 6. Say what arrived, and what still has to be done -------------------
  Write-Log ("Target now holds: {0}" -f (Get-Counts))

  Write-Output ""
  Write-Output "Two things this script deliberately does NOT do, because both need a decision:"
  Write-Output ""
  Write-Output "  1. The migration history came with the backup. If it is a copy of a"
  Write-Output "     development database, most migrations are unrecorded there and"
  Write-Output "     migration:run would try to apply changes the schema already has. Print"
  Write-Output "     the exact statement to fix that with:"
  Write-Output ""
  Write-Output "       podman exec $BackendContainer npm run verify:migrations"
  Write-Output ""
  Write-Output "     then run the INSERT it names, and only then migration:run."
  Write-Output ""
  Write-Output "  2. The accounts came with the backup too - including any test users and"
  Write-Output "     development passwords. List and remove them with:"
  Write-Output ""
  Write-Output "       podman exec $BackendContainer npm run prune:dev-accounts"
  Write-Output "       podman exec -it $BackendContainer npm run set:password -- --username admin"
  Write-Output ""

  Write-Log "Done."
  exit 0
} catch {
  Write-Log ("FAILED: {0}" -f $_.Exception.Message)
  Write-Log "If this failed during the RESTORE itself, the target database may be incomplete."
  Write-Log "The safety backup taken at the start is the way back."
  exit 1
}
