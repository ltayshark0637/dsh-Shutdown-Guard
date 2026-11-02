# Publishes this repo to https://github.com/ltayshark0637/dsh-Shutdown-Guard
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/push.ps1
#
# The remote already has an unrelated scaffold (Initial commit + "Delete
# README.md"), so this replaces it wholesale. Everything is on `main`.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# This machine reaches GitHub only through the local proxy; git does not read
# the Windows Internet Settings the way a browser does.
if (-not (git config --local --get http.proxy)) {
  git config --local http.proxy http://127.0.0.1:26561
}

git push --set-upstream origin main --force
git push origin --tags

Write-Host ''
Write-Host 'Done. Tags pushed separately above; verify at:'
Write-Host '  https://github.com/ltayshark0637/dsh-Shutdown-Guard'
