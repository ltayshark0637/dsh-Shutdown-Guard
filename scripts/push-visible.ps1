# Push dsh-Shutdown-Guard to GitHub with a Personal Access Token.
#
# Why a token: GCM on this machine cannot complete a push. It opens its
# "Connect to GitHub" window, the sign-in succeeds, and git then fails with
#   fatal: <task cancelled>. bash: line 1: /dev/tty: No such device or address
# because GCM tries to finish over a tty that a GUI session does not have.
# So this script bypasses the credential helper completely
# (-c credential.helper=) and authenticates with a token pasted here.
#
# The token is never echoed, never written to disk, never stored in git config
# and never put in the transcript: it exists only in this process's memory and
# in the argument list of the two push commands.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\push-visible.ps1
$ErrorActionPreference = 'Continue'
$repo   = Split-Path -Parent $PSScriptRoot
$remote = 'https://github.com/ltayshark0637/dsh-Shutdown-Guard'
Set-Location $repo

$log = Join-Path $env:TEMP ("guard-push-" + (Get-Date -Format 'HHmmss') + ".log")
try { Start-Transcript -Path $log -Force | Out-Null } catch { }

Write-Host ''
Write-Host '=========================================================' -ForegroundColor DarkGray
Write-Host '  Push dsh-Shutdown-Guard  ->  origin/main' -ForegroundColor Cyan
Write-Host '=========================================================' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'A GitHub token is required. Create one here:' -ForegroundColor Yellow
Write-Host '  https://github.com/settings/personal-access-tokens/new' -ForegroundColor Gray
Write-Host '    Repository access : Only select repositories -> dsh-Shutdown-Guard' -ForegroundColor Gray
Write-Host '    Permissions       : Contents = Read and write' -ForegroundColor Gray
Write-Host ''
Write-Host 'Paste the token below (input hidden), then press Enter.' -ForegroundColor Yellow
Write-Host ''

$secure = Read-Host -AsSecureString 'Token'
$bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try   { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host 'No token entered - nothing was pushed.' -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}

# Only the push URLs carry the token; git config is left untouched.
$authMain = $remote -replace '^https://', ("https://x-access-token:{0}@" -f $token)

Write-Host ''
Write-Host '--- main (forced) ---' -ForegroundColor DarkGray
& git -c credential.helper= push --force $authMain 'main:main'
$mainOk = ($LASTEXITCODE -eq 0)

Write-Host ''
Write-Host '--- tags ---' -ForegroundColor DarkGray
& git -c credential.helper= push $authMain --tags
$tagsOk = ($LASTEXITCODE -eq 0)

$token = $null
$authMain = $null
Remove-Variable secure, bstr -ErrorAction SilentlyContinue

Write-Host ''
Write-Host ('main : ' + $(if ($mainOk) { 'pushed' } else { 'FAILED' })) -ForegroundColor $(if ($mainOk) { 'Green' } else { 'Red' })
Write-Host ('tags : ' + $(if ($tagsOk) { 'pushed' } else { 'skipped / already current' })) -ForegroundColor $(if ($tagsOk) { 'Green' } else { 'Yellow' })
if ($mainOk) {
  Write-Host ''
  Write-Host 'Open: https://github.com/ltayshark0637/dsh-Shutdown-Guard' -ForegroundColor Cyan
}

try { Stop-Transcript | Out-Null } catch { }
Write-Host ''
Write-Host '--- window closes in 300s ---' -ForegroundColor DarkGray
Write-Host "transcript: $log" -ForegroundColor DarkGray
Start-Sleep -Seconds 300
