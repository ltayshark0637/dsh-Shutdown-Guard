# Publishes this repo to https://github.com/ltayshark0637/dsh-Shutdown-Guard
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/push.ps1
#
# The remote currently holds an unrelated scaffold (Initial commit +
# "Delete README.md"), so this replaces it wholesale — hence --force.
#
# If git has no stored GitHub credential, this asks for a token with
# Read-Host -AsSecureString: no echo, no shell history, and the variable is
# cleared before the script exits. The token is passed in the push URL only;
# it is never written to git config or to a file.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$remote = 'https://github.com/ltayshark0637/dsh-Shutdown-Guard.git'

# This machine reaches GitHub only through the local proxy; git does not read
# the Windows Internet Settings the way a browser does.
if (-not (git config --local --get http.proxy)) {
  git config --local http.proxy http://127.0.0.1:26561
}

# Prefer a credential the helper already has, so a normal run never prompts.
$env:GIT_TERMINAL_PROMPT = '0'
$haveCred = $false
try {
  $probe = "protocol=https`nhost=github.com`nusername=ltayshark0637`n`n" | git credential fill 2>$null
  $haveCred = ($LASTEXITCODE -eq 0) -and ($probe -match 'password=')
} catch { $haveCred = $false }
Remove-Item Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue

$target = $remote
$plain = $null
if (-not $haveCred) {
  $sec = Read-Host '粘贴 GitHub token（不会回显、不进历史）' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if ([string]::IsNullOrWhiteSpace($plain)) { throw '没有拿到 token。' }
  $target = "https://$($plain)@github.com/ltayshark0637/dsh-Shutdown-Guard.git"
}

try {
  git push --set-upstream origin main --force $target
  git push $target --tags
} finally {
  # Clear the secret whether the push succeeded or not.
  Remove-Variable plain, sec -ErrorAction SilentlyContinue
  $target = $remote
}

Write-Host ''
Write-Host 'Done. Verify at:'
Write-Host '  https://github.com/ltayshark0637/dsh-Shutdown-Guard'
Write-Host ''
Write-Host 'If you pasted a token, revoke it now unless you set a short expiry:'
Write-Host '  https://github.com/settings/tokens'
