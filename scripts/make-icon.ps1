# Builds assets/icon.ico from assets/icon.png (16-256 px PNG entries).
param(
  [string]$Source = "$PSScriptRoot\..\assets\icon.png",
  [string]$Target = "$PSScriptRoot\..\assets\icon.ico"
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
$sizes = 16, 24, 32, 48, 64, 128, 256
$entries = @()
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $entries += , @($s, $ms.ToArray())
  $bmp.Dispose()
}
$src.Dispose()
$fs = [System.IO.File]::Create($Target)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
  $s = $e[0]
  $data = $e[1]
  $dim = if ($s -eq 256) { 0 } else { $s }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($e in $entries) { $bw.Write($e[1]) }
$bw.Flush()
$bw.Close()
Write-Output "Wrote $Target"
