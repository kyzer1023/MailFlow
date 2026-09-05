param(
  [Parameter(Mandatory=$true)][string]$Reference,
  [Parameter(Mandatory=$true)][string]$Capture,
  [Parameter(Mandatory=$true)][string]$Output,
  [int]$ReferenceTop = 45
)
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Reference))
$rendered = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Capture))
$height = $source.Height - $ReferenceTop
$sheet = New-Object System.Drawing.Bitmap ($source.Width * 2), $height
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
try {
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sourceRect = New-Object System.Drawing.Rectangle 0, $ReferenceTop, $source.Width, $height
  $leftRect = New-Object System.Drawing.Rectangle 0, 0, $source.Width, $height
  $rightRect = New-Object System.Drawing.Rectangle $source.Width, 0, $source.Width, $height
  $graphics.DrawImage($source, $leftRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.DrawImage($rendered, $rightRect)
  $sheet.Save([System.IO.Path]::GetFullPath($Output), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $sheet.Dispose()
  $source.Dispose()
  $rendered.Dispose()
}
