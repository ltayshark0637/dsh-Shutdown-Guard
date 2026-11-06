# Renders every docs/screenshots/*.html into its own PNG using headless Edge.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1
#   powershell ... -File scripts/screenshot.ps1 -Filter '02-armed.*.html'   # one batch only
#
# Which language a page carries is decided by gen-gallery.cjs:
#   node scripts/gen-gallery.cjs --lang all       -> <name>.<lang>.html for zh/en/ru
#   node scripts/gen-gallery.cjs --matrix         -> 18 pages, <nn>-armed-<variant>-<lang>-<theme>
# This script writes <same-name>.png next to each page.
#
# Two details make this reproducible:
#  * each run gets a throwaway user-data-dir; reusing the default profile makes
#    headless Edge exit silently without writing the file;
#  * --default-background-color=00000000 keeps the page transparent, so the
#    images drop straight onto any README background. The alpha border is then
#    trimmed away, which is why the window is deliberately oversized.
param([string]$Filter = '*.html')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$shots = Join-Path $root 'docs/screenshots'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { throw "Edge not found at $edge" }

# Oversized on purpose: Trim-Png cuts it down to the ink.
# The settings page has six groups and a profile list that grows with the number
# of custom profiles, so its window is tall; Trim only crops transparency and
# will not add height back.
function Get-Size($name) {
  if ($name -like '*settings*') { return @(760, 2600) }
  if ($name -like '*sidebar*') { return @(420, 660) }
  return @(430, 380)
}

function Trim-Png($path) {
  $src = [System.Drawing.Bitmap]::FromFile($path)
  try {
    # GetPixel over a 760x1640 canvas is far too slow; copy to a 32bpp buffer
    # and walk its bytes instead.
    $buf = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($buf)
    $g.DrawImage($src, 0, 0, $src.Width, $src.Height)
    $g.Dispose()

    $rect0 = New-Object System.Drawing.Rectangle(0, 0, $buf.Width, $buf.Height)
    $data = $buf.LockBits($rect0, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $bytes = New-Object byte[] ($stride * $buf.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $buf.UnlockBits($data)

    $minX = $buf.Width; $minY = $buf.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $buf.Height; $y++) {
      $row = $y * $stride
      for ($x = 0; $x -lt $buf.Width; $x++) {
        $alpha = $bytes[$row + $x * 4 + 3]
        if ($alpha -gt 8) {
          if ($x -lt $minX) { $minX = $x }
          if ($x -gt $maxX) { $maxX = $x }
          if ($y -lt $minY) { $minY = $y }
          if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }
    if ($maxX -lt 0) { $buf.Dispose(); return }

    $pad = 4
    $minX = [Math]::Max(0, $minX - $pad); $minY = [Math]::Max(0, $minY - $pad)
    $maxX = [Math]::Min($buf.Width - 1, $maxX + $pad); $maxY = [Math]::Min($buf.Height - 1, $maxY + $pad)
    $keep = New-Object System.Drawing.Rectangle($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
    $dst = $buf.Clone($keep, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $buf.Dispose()

    # GDI+ refuses to write over the file its source was loaded from, so the
    # trimmed copy lands on a sibling and swaps in afterwards. The source bitmap
    # must be released before the swap on Windows.
    $tmp = "$path.trim.png"
    try {
      $dst.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $dst.Dispose() }
  } finally { $src.Dispose() }
  Move-Item -LiteralPath $tmp -Destination $path -Force
}

# The filter may be a glob like '*-armed-*', which would also match the PNGs
# written on a previous run; keep only the HTML pages.
$pages = Get-ChildItem $shots -Filter $Filter |
  Where-Object { $_.Extension -eq '.html' -and $_.Name -ne 'banner.html' } |
  Sort-Object Name
foreach ($page in $pages) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($page.Name)
  $png = Join-Path $shots "$name.png"
  $w, $h = Get-Size $name
  $profile = Join-Path $env:TEMP ('edge-shot-' + [guid]::NewGuid().ToString('N'))
  $uri = 'file:///' + ($page.FullName -replace '\\', '/')
  # headless Edge exits 1 even on success and writes noise to stderr; only the
  # written file matters, so both are swallowed on purpose.
  $ErrorActionPreference = 'Continue'
  & $edge --headless=new --disable-gpu --no-sandbox --hide-scrollbars `
    --force-device-scale-factor=2 --default-background-color=00000000 `
    "--user-data-dir=$profile" --window-size=$w,$h `
    "--screenshot=$png" $uri 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
  if (Test-Path $png) {
    Trim-Png $png
    $img = [System.Drawing.Image]::FromFile($png)
    $size = "{0}x{1}" -f $img.Width, $img.Height
    $img.Dispose()
    Write-Host ("{0,-22} {1,-12} {2} KB" -f $name, $size, [int]((Get-Item $png).Length / 1KB))
  } else {
    Write-Warning "not written: $png"
  }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}
