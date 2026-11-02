# Renders every docs/screenshots/*.html into a PNG using headless Edge.
#
#   pwsh -File scripts/screenshot.ps1
#
# Each run gets a throwaway user-data-dir: reusing the default profile makes
# headless Edge exit silently without writing the file.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shots = Join-Path $root 'docs/screenshots'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { throw "Edge not found at $edge" }

# page -> viewport height that fits the whole gallery without a scrollbar
$sizes = @{
  '01-hero'     = @(1330, 1120)
  '02-states'   = @(1060, 680)
  '03-variants' = @(1180, 730)
  '04-blocked'  = @(1330, 1560)
  '05-settings' = @(1330, 1560)
  '06-light'    = @(1180, 1080)
}

foreach ($name in ($sizes.Keys | Sort-Object)) {
  $html = Join-Path $shots "$name.html"
  if (-not (Test-Path $html)) { Write-Warning "missing $html"; continue }
  $png = Join-Path $shots "$name.png"
  $w, $h = $sizes[$name]
  $profile = Join-Path $env:TEMP ('edge-shot-' + [guid]::NewGuid().ToString('N'))
  $uri = 'file:///' + ($html -replace '\\', '/')
  # headless Edge exits 1 even on success and writes noise to stderr; only the
  # written file matters, so both are swallowed on purpose.
  $ErrorActionPreference = 'Continue'
  & $edge --headless=new --disable-gpu --no-sandbox --hide-scrollbars `
    --force-device-scale-factor=2 "--user-data-dir=$profile" `
    "--window-size=$w,$h" "--screenshot=$png" $uri 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
  if (Test-Path $png) {
    Write-Host ("{0}  {1}x{2}  {3} KB" -f $name, $w, $h, [int]((Get-Item $png).Length / 1KB))
  } else {
    Write-Warning "not written: $png"
  }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}
