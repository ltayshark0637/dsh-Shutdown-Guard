# Publishes this repo to https://github.com/ltayshark0637/dsh-Shutdown-Guard
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/push.ps1
#
# The remote holds an unrelated scaffold (Initial commit + "Delete README.md"),
# so this replaces it wholesale - hence --force.
#
# Credentials: Git Credential Manager is tried first (it may open a "Connect to
# GitHub" window). Only if that yields nothing does this ask for a token with
# Read-Host -AsSecureString: no echo, no shell history, and the variable is
# cleared before the script exits. Any token rides in the push URL only - never
# written to git config or to a file.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$remote = 'https://github.com/ltayshark0637/dsh-Shutdown-Guard.git'

# This machine reaches GitHub only through the local proxy; git does not read
# the Windows Internet Settings the way a browser does.
if (-not (git config --local --get http.proxy)) {
  git config --local http.proxy http://127.0.0.1:26561
}

Write-Host 'Trying the stored GitHub credential...' -ForegroundColor Gray
& git push --force $remote 'main:main' 2>&1 | Write-Host
$storedWorked = ($LASTEXITCODE -eq 0)

if ($storedWorked) {
  & git push $remote --tags 2>&1 | Write-Host
  Write-Host ''
  Write-Host 'Pushed main and tags.' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'No usable stored credential. Paste a token instead.' -ForegroundColor Yellow
  Write-Host 'Create one limited to this repo with Contents: Read and write:' -ForegroundColor Gray
  Write-Host '  https://github.com/settings/personal-access-tokens/new' -ForegroundColor Gray
  Write-Host ''
  $sec = Read-Host 'GitHub token (input is hidden)' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'No token entered.' }
  $withToken = 'https://{0}@github.com/ltayshark0637/dsh-Shutdown-Guard.git' -f $plain
  try {
    & git push --force $withToken 'main:main' 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "push failed with exit code $LASTEXITCODE" }
    & git push $withToken --tags 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "tag push failed with exit code $LASTEXITCODE" }
    Write-Host ''
    Write-Host 'Pushed main and tags.' -ForegroundColor Green
  } finally {
    Remove-Variable plain, sec, withToken -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host 'Verify at: https://github.com/ltayshark0637/dsh-Shutdown-Guard'
Write-Host ''
Write-Host 'If you pasted a token, revoke it now unless you set a short expiry:'
Write-Host '  https://github.com/settings/tokens'
