# Compile the x64 desktop host and collect the redistributable WebView2 bindings.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = [IO.Path]::GetFullPath($OutputDir)
[void][IO.Directory]::CreateDirectory($output)
$version = '1.0.4314.35'
$sha = '90778DEB1B77E36292828B4B5833C9255C27533F40E0DDD55891AE718944EDC4'
$cache = Join-Path $root '.cache/mstudio-sdk'
[void][IO.Directory]::CreateDirectory($cache)
$package = Join-Path $cache "microsoft.web.webview2.$version.nupkg"
if (!(Test-Path -LiteralPath $package) -or (Get-FileHash -LiteralPath $package).Hash -ne $sha) {
    $download = "$package.$PID.tmp"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg" -OutFile $download
        if ((Get-FileHash -LiteralPath $download).Hash -ne $sha) { throw 'The Microsoft.Web.WebView2 package did not match its published build input.' }
        Copy-Item -LiteralPath $download -Destination $package -Force
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
    }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($package)
try {
    $files = @{
        'lib/net462/Microsoft.Web.WebView2.Core.dll'='Microsoft.Web.WebView2.Core.dll'
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll'='Microsoft.Web.WebView2.WinForms.dll'
        'runtimes/win-x64/native/WebView2Loader.dll'='WebView2Loader.dll'
        'LICENSE.txt'='licenses/Microsoft.Web.WebView2.txt'
    }
    foreach ($entry in $files.GetEnumerator()) {
        $dest = Join-Path $output $entry.Value
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))
        [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry($entry.Key),$dest,$true)
    }
} finally { $zip.Dispose() }
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (![IO.File]::Exists($csc)) { throw 'The Windows .NET Framework x64 C# compiler is missing.' }
$refs = @('System.dll','System.Core.dll','System.Drawing.dll','System.Management.dll','System.Windows.Forms.dll','System.Web.Extensions.dll')
$refs += Join-Path ([IO.Path]::GetDirectoryName($csc)) 'Microsoft.VisualBasic.dll'
$refs += Join-Path $output 'Microsoft.Web.WebView2.Core.dll'
$refs += Join-Path $output 'Microsoft.Web.WebView2.WinForms.dll'
$references = @($refs | ForEach-Object { "/r:$_" })
$launcher = Join-Path $PSScriptRoot 'MStudio.cs'
$picker = Join-Path $PSScriptRoot 'Launcher.cs'
$language = Join-Path $PSScriptRoot 'Lang.cs'
$assistant = Join-Path $PSScriptRoot 'MStudio.Update.cs'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /define:MSTUDIO /main:MStudioProgram "/out:$output\MStudio.exe" "/win32icon:$PSScriptRoot\mstudio.ico" "/win32manifest:$PSScriptRoot\mstudio.manifest" @references $launcher $picker $language $assistant
if ($LASTEXITCODE) { throw 'MStudio.exe failed to compile.' }
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$output\MStudio.Update.exe" "/win32icon:$PSScriptRoot\mstudio.ico" "/win32manifest:$PSScriptRoot\mstudio.manifest" /r:System.dll /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll $assistant
if ($LASTEXITCODE) { throw 'MStudio.Update.exe failed to compile.' }
Write-Output "$output/MStudio.exe"
