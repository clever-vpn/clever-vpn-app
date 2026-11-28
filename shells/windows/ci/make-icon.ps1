<#
  把 dist/icon.png（1024×1024 PNG）转成应用要的 .ico（多尺寸、PNG 压缩条目）。

  用法：pwsh -File shells/windows/ci/make-icon.ps1 -Source <png> -Dest <ico>
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Dest
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { throw "找不到图标源文件：$Source" }

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  if ($src.Width -ne $src.Height) { throw "图标必须是正方形（当前 $($src.Width)×$($src.Height)）" }
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($src, 0, 0, $size, $size)
    } finally { $g.Dispose() }
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $images += ,@($size, $ms.ToArray())
    $bmp.Dispose(); $ms.Dispose()
  }
} finally { $src.Dispose() }

$out = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $out
try {
  $writer.Write([UInt16]0)            # reserved
  $writer.Write([UInt16]1)            # type = icon
  $writer.Write([UInt16]$images.Count)

  $offset = 6 + (16 * $images.Count)
  foreach ($image in $images) {
    $size = [int]$image[0]
    $bytes = [byte[]]$image[1]
    $dim = if ($size -ge 256) { 0 } else { $size }
    $writer.Write([byte]$dim)         # width
    $writer.Write([byte]$dim)         # height
    $writer.Write([byte]0)            # palette
    $writer.Write([byte]0)            # reserved
    $writer.Write([UInt16]1)          # planes
    $writer.Write([UInt16]32)         # bpp
    $writer.Write([UInt32]$bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $bytes.Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image[1]) }
} finally { $writer.Dispose() }

$dir = Split-Path -Parent $Dest
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllBytes($Dest, $out.ToArray())
$out.Dispose()
Write-Host "✓ 图标 $Source → $Dest（$($sizes -join '/') px）"
