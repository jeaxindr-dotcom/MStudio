# Produces the window, installer and library icons from one scalable mark.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-IconImage([int]$Size) {
    $image = [Drawing.Bitmap]::new($Size, $Size)
    $g = [Drawing.Graphics]::FromImage($image)
    $g.SmoothingMode = 'AntiAlias'
    $g.ScaleTransform($Size / 256.0, $Size / 256.0)
    $bg = [Drawing.Drawing2D.GraphicsPath]::new()
    foreach ($corner in @(@(6,6,180), @(166,6,270), @(166,166,0), @(6,166,90))) {
        $bg.AddArc($corner[0], $corner[1], 84, 84, $corner[2], 90)
    }
    $bg.CloseFigure()
    $rect = [Drawing.Rectangle]::new(6,6,244,244)
    $surface = [Drawing.Drawing2D.LinearGradientBrush]::new($rect, [Drawing.Color]::FromArgb(36,56,57), [Drawing.Color]::FromArgb(14,27,31), 52.0)
    $rim = [Drawing.Pen]::new([Drawing.Color]::FromArgb(75,108,104), 3)
    $ink = [Drawing.Drawing2D.LinearGradientBrush]::new($rect, [Drawing.Color]::FromArgb(201,255,206), [Drawing.Color]::FromArgb(78,212,172), 63.0)
    $mark = [Drawing.Drawing2D.GraphicsPath]::new()
    # Two slanted strokes meet in a valley. The right edge follows the angle of the left.
    $points = foreach ($p in @(@(42,182),@(65,73),@(93,73),@(126,132),@(169,73),@(205,73),@(182,182),@(150,182),@(164,116),@(124,168),@(115,168),@(88,118),@(75,182))) {
        [Drawing.Point]::new($p[0], $p[1])
    }
    $mark.AddPolygon([Drawing.Point[]]$points)
    $stream = [IO.MemoryStream]::new()
    try {
        $g.Clear([Drawing.Color]::Transparent)
        $g.FillPath($surface,$bg)
        $g.DrawPath($rim,$bg)
        $g.FillPath($ink,$mark)
        $image.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally {
        foreach ($resource in @($stream,$mark,$ink,$rim,$surface,$bg,$g,$image)) { $resource.Dispose() }
    }
}

$sizes = @(256,128,64,48,32,24,16)
$images = @{}
foreach ($size in $sizes) { $images[$size] = New-IconImage $size }
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'mstudio.png'),$images[256])
$output = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($output)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    foreach ($size in $sizes) {
        $edge = [byte]($size % 256)
        $writer.Write($edge)
        $writer.Write($edge)
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$size].Length)
        $writer.Write([uint32]$offset)
        $offset += $images[$size].Length
    }
    foreach ($size in $sizes) { $writer.Write([byte[]]$images[$size]) }
    $writer.Flush()
    [IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'mstudio.ico'),$output.ToArray())
} finally { $writer.Dispose(); $output.Dispose() }
