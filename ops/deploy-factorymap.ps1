<#
.SYNOPSIS
  Redeploys factory-map on the VM: pull, rebuild, migrate, republish, verify.

.DESCRIPTION
  Why this exists: the redeploy is a nine-step sequence with a trap in the middle.
  Recreating a container drops the netsh portproxy rules, so the rules have to come
  down before the rebuild and go back up after - otherwise the app reports itself
  healthy and is unreachable from every other machine (see docs/DEPLOYMENT.md).
  Done by hand, the steps that get skipped are the ones with no immediate symptom:
  the portproxy rules, `migration:run`, and checking /health against the real
  hostname rather than localhost (localhost answers even when the proxy is broken).

  What it does, stopping at the first failure:
    1. git pull (refuses to run with uncommitted changes, so nothing is discarded)
    2. Removes the portproxy rules
    3. Rebuilds and restarts the compose stack
    4. Waits for the backend container to report healthy
    5. Runs migration:run - a no-op when there is nothing new
    6. Restores the portproxy rules
    7. Checks /health on the real hostname, which is the only check that proves
       the deploy is reachable

  On failure it says which step failed AND what state that leaves behind - a
  half-done deploy is worse than a failed one, so it must not be silent. In
  particular, if it dies between steps 2 and 6 the portproxy rules are down and
  the script says so explicitly.

  NOTE: deliberately ASCII-only. Windows PowerShell 5.1 reads .ps1 files as ANSI
  unless they carry a UTF-8 BOM, so an accented or box-drawing character in here
  would break parsing on the VM depending on how the file was saved. This is not
  a style choice; it cost an evening once.

.PARAMETER Root
  The checkout on the VM, e.g. C:\factory-map.

.PARAMETER HostName
  The hostname other machines use, for the closing health check. NOT localhost:
  localhost answers even when the portproxy rules are missing, which is exactly
  the failure this check exists to catch.

.PARAMETER SkipPull
  Deploy what is already checked out. For re-running after a failed step.

.PARAMETER DryRun
  Prints every step without running any of them - no pull, no netsh, no rebuild,
  no migration. For reading what a deploy would do before trusting it with one.

.EXAMPLE
  .\deploy-factorymap.ps1 -Root C:\factory-map -HostName srvmmh112vm.maxonmotor.com

.EXAMPLE
  .\deploy-factorymap.ps1 -Root C:\factory-map -HostName srvmmh112vm.maxonmotor.com -SkipPull
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Root,
  [Parameter(Mandatory = $true)] [string] $HostName,
  [switch] $SkipPull,
  [switch] $DryRun,
  [string] $EnvFile = '.env.prod',
  [string] $ComposeFile = 'docker-compose.prod.yml',
  [string] $BackendContainer = 'factory-map-backend',
  [string] $ComposeExe = 'docker-compose',
  [string] $PodmanExe = 'podman',
  [int[]] $Ports = @(4000, 8080),
  [int] $HealthTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'

function Write-Log([string] $Message) {
  Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message)
}

# Native commands write to stderr for ordinary progress output (git and podman both
# do), and with $ErrorActionPreference='Stop' that turns into a NativeCommandError
# which hides the real exit code. So native calls go through here and are judged on
# their exit code alone.
#
# The exit code comes back in $script:NativeExit rather than as a return value: this
# function also prints (the command's own output, or the "would run" line in a dry
# run), and in PowerShell anything written to the output stream is part of what the
# caller captures. A `$code = Invoke-Native ...` therefore collected the printed text
# alongside the number and compared an array against 0 - which reported a successful
# git pull as a failure. Found by the first dry run.
$script:NativeExit = 0

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)] [string[]] $CommandLine,
    [switch] $PassThruOutput
  )
  if ($DryRun) {
    Write-Output ("    would run: " + ($CommandLine -join ' '))
    $script:NativeExit = 0
    return
  }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # Not named $args: that is an automatic variable inside a function, and
    # shadowing it is the kind of thing that works until it doesn't.
    $rest = @()
    if ($CommandLine.Length -gt 1) { $rest = $CommandLine[1..($CommandLine.Length - 1)] }
    if ($PassThruOutput) {
      & $CommandLine[0] @rest 2>&1 | ForEach-Object { Write-Output ("    " + $_) }
    } else {
      & $CommandLine[0] @rest 2>&1 | Out-Null
    }
    $script:NativeExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Remove-PortProxy {
  foreach ($port in $Ports) {
    # Not checked: deleting a rule that is not there is a normal outcome here.
    Invoke-Native @('netsh', 'interface', 'portproxy', 'delete', 'v4tov4',
                    "listenport=$port", 'listenaddress=0.0.0.0')
  }
}

function Add-PortProxy {
  foreach ($port in $Ports) {
    Invoke-Native @('netsh', 'interface', 'portproxy', 'add', 'v4tov4',
                    "listenport=$port", 'listenaddress=0.0.0.0',
                    "connectport=$port", 'connectaddress=127.0.0.1')
    if ($script:NativeExit -ne 0) {
      throw "netsh could not add the portproxy rule for port $port (exit $script:NativeExit)."
    }
  }
}

# Tracks whether the rules are currently down, so the failure message can say so.
$proxyIsDown = $false

try {
  if (-not (Test-Path $Root)) { throw "Root not found: $Root" }
  Set-Location $Root
  if (-not (Test-Path $EnvFile)) { throw "$EnvFile not found in $Root - the compose stack needs it." }

  # --- 1. Pull ---------------------------------------------------------------
  if ($SkipPull) {
    Write-Log "Skipping git pull (-SkipPull); deploying what is checked out."
  } else {
    # Local edits on the VM are usually a hotfix someone made in place. Pulling
    # over them either fails confusingly or loses them, so stop and say so.
    $dirty = & git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw "git status failed - is $Root a git checkout?" }
    if ($DryRun -and $dirty) {
      Write-Output "    (dry run) the checkout is dirty, so a real run would stop here:"
      Write-Output $dirty
      $dirty = $null
    }
    if ($dirty) {
      Write-Output $dirty
      throw "The checkout has uncommitted changes (listed above). Commit, stash or discard them, or re-run with -SkipPull."
    }
    Write-Log "git pull"
    Invoke-Native @('git', 'pull') -PassThruOutput
    if ($script:NativeExit -ne 0) { throw "git pull failed (exit $script:NativeExit)." }
  }

  $head = (& git rev-parse --short HEAD).Trim()
  Write-Log "Deploying $head"

  # --- 2. Portproxy down ------------------------------------------------------
  Write-Log "Removing the portproxy rules (they do not survive a container recreate)."
  Remove-PortProxy
  if (-not $DryRun) { $proxyIsDown = $true }

  # --- 3. Rebuild -------------------------------------------------------------
  Write-Log "Rebuilding and restarting the stack - this takes a few minutes."
  Invoke-Native @($ComposeExe, '--env-file', $EnvFile, '-f', $ComposeFile,
                  'up', '-d', '--build') -PassThruOutput
  if ($script:NativeExit -ne 0) {
    throw "compose up --build failed (exit $script:NativeExit). The previous containers may still be running."
  }

  # --- 4. Wait for the backend ------------------------------------------------
  # Migrations run against the database through the backend container, so it has to
  # be up first. Polling the container's own health state rather than sleeping a
  # fixed time: the first start after a rebuild is much slower than a restart.
  Write-Log "Waiting for $BackendContainer to report healthy."
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  $healthy = $DryRun
  while (-not $healthy -and (Get-Date) -lt $deadline) {
    $state = (& $PodmanExe inspect --format '{{.State.Health.Status}}' $BackendContainer 2>&1 | Out-String).Trim()
    if ($state -eq 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 5
  }
  if (-not $healthy) {
    throw "$BackendContainer did not become healthy within $HealthTimeoutSeconds seconds. Check '$PodmanExe logs $BackendContainer'."
  }
  if ($DryRun) {
    Write-Log ("    would wait up to {0}s for {1} to report healthy" -f $HealthTimeoutSeconds, $BackendContainer)
  } else {
    Write-Log "Backend is healthy."
  }

  # --- 5. Migrations ----------------------------------------------------------
  # A no-op when there is nothing new, so it runs on every deploy as a matter of
  # habit rather than as a decision someone has to remember to make.
  Write-Log "Running migrations."
  Invoke-Native @($PodmanExe, 'exec', $BackendContainer, 'npm', 'run', 'migration:run') -PassThruOutput
  if ($script:NativeExit -ne 0) {
    throw "migration:run failed (exit $script:NativeExit). The new code is running against the old schema - fix this before using the app."
  }

  # --- 6. Portproxy back ------------------------------------------------------
  Write-Log "Restoring the portproxy rules."
  Add-PortProxy
  $proxyIsDown = $false

  # --- 7. Prove it is reachable ----------------------------------------------
  # Against the real hostname on purpose: localhost answers even when the
  # portproxy rules are missing, so a localhost check proves nothing.
  $url = "http://{0}:4000/health" -f $HostName
  Write-Log "Checking $url"
  if ($DryRun) {
    Write-Log "    would GET $url and require a response"
  } else {
    $response = Invoke-RestMethod -Uri $url -TimeoutSec 20
    Write-Log ("Health: " + ($response | ConvertTo-Json -Compress))
  }

  if ($DryRun) {
    Write-Log "Dry run finished. Nothing was pulled, rebuilt, migrated or re-proxied."
  } else {
    Write-Log "Deploy of $head complete and reachable."
  }
  exit 0

} catch {
  Write-Output ""
  Write-Output ("DEPLOY FAILED: " + $_.Exception.Message)
  if ($proxyIsDown) {
    Write-Output ""
    Write-Output "IMPORTANT: the portproxy rules are still removed, so the app is unreachable"
    Write-Output "from other machines even if the containers are running. Restore them with:"
    foreach ($port in $Ports) {
      Write-Output ("  netsh interface portproxy add v4tov4 listenport={0} listenaddress=0.0.0.0 connectport={0} connectaddress=127.0.0.1" -f $port)
    }
    Write-Output "or re-run this script once the cause is fixed."
  }
  exit 1
}
