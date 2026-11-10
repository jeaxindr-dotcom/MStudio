#requires -Version 7.2
# Build the Windows x64 installer. Every archive is pinned below and the npm
# engine is installed from its checked-in package-lock.json at build time.
[CmdletBinding()]
param([string]$OutputDir, [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $IsWindows) { throw 'Compile MStudio on Windows x64.' }
$cache = Join-Path $root '.cache/mstudio-package'
$downloads = Join-Path $cache 'downloads'
$definition = Join-Path $PSScriptRoot 'mstudio-package'
if (-not $OutputDir) { $OutputDir = Join-Path $root '.cache/mstudio-release' }
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
[void][IO.Directory]::CreateDirectory($downloads)
[void][IO.Directory]::CreateDirectory($OutputDir)
$version = '0.2.1'

function Get-Archive([string]$FileName, [string]$Url, [string]$Hash) {
    $file = Join-Path $downloads $FileName
    if ([IO.File]::Exists($file) -and (Get-FileHash -LiteralPath $file).Hash -eq $Hash) { return $file }
    Write-Host "Downloading $FileName"
    $temporary = "$file.$PID.tmp"
    try {
        & curl.exe --fail --location --silent --show-error --retry 2 $Url --output $temporary
        if ($LASTEXITCODE -ne 0) { throw "Download failed for $FileName." }
        if ((Get-FileHash -LiteralPath $temporary).Hash -ne $Hash) { throw "SHA-256 mismatch for $FileName." }
        [IO.File]::Move($temporary, $file, $true)
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
    return $file
}

function Expand-Tool([string]$Archive, [string]$Destination, [string]$MarkerPath) {
    $complete = Join-Path $cache $MarkerPath
    $expected = [IO.Path]::GetFileName($Archive)
    if ([IO.File]::Exists($complete) -and [IO.File]::ReadAllText($complete) -eq $expected) { return }
    [void][IO.Directory]::CreateDirectory($Destination)
    & tar.exe -xf $Archive -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "Extraction failed for $Archive." }
    [IO.File]::WriteAllText($complete, $expected)
}

function Copy-Tree([string]$From, [string]$To) {
    & robocopy.exe $From $To /E /XJ /MT:12 /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD .cache .git /XF .mstudio-build-complete | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed: $From to $To (robocopy $LASTEXITCODE)." }
}

# Serializing cache initialization also protects concurrent invocations of npm ci.
$lock = [IO.File]::Open((Join-Path $cache 'build.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $nodeZip = Get-Archive 'node-v24.22.2-win-x64.zip' 'https://nodejs.org/dist/v24.22.2/node-v24.22.2-win-x64.zip' 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
    $ffmpegZip = Get-Archive 'ffmpeg-8.0-full_build-shared.zip' 'https://github.com/GyanD/codexffmpeg/releases/download/8.0/ffmpeg-8.0-full_build-shared.zip' 'd2bfb598ec5d8d69c86cb198decc829fefb2c0acaa7ddd27ab5348139cce3dea'
    $innoZip = Get-Archive 'tools.innosetup.6.7.1.nupkg' 'https://api.nuget.org/v3-flatcontainer/tools.innosetup/6.7.1/tools.innosetup.6.7.1.nupkg' '00a5a07e8a4bd3a30364cb579d744677b37adfc22e365099cb01b8bd1e651828'
    $webview = Get-Archive 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe' 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/199041ce-790a-4bbc-9111-b81b4c926e9f/MicrosoftEdgeWebView2RuntimeInstallerX64.exe' '1be9d2926954d99dd62653a22efe813160fe0c40f1e422b44e6aaf5473f68eec'
    Expand-Tool $nodeZip $cache 'node-v24.22.2-win-x64.ok'
    Expand-Tool $ffmpegZip $cache 'ffmpeg-8.0-full_build-shared.ok'
    $inno = Join-Path $cache 'inno-6.7.1'
    Expand-Tool $innoZip $inno 'inno-6.7.1.ok'
    $node = Join-Path $cache 'node-v24.22.2-win-x64'
    $ffmpeg = Join-Path $cache 'ffmpeg-8.0-full_build-shared'
    $engineSpec = Join-Path $definition 'engine'
    $engineHash = (Get-FileHash -LiteralPath (Join-Path $engineSpec 'package-lock.json')).Hash.Substring(0,16)
    $engine = Join-Path $cache "engine-$engineHash"
    $engineStamp = Join-Path $engine '.mstudio-build-complete'
    if (-not [IO.File]::Exists($engineStamp)) {
        [void][IO.Directory]::CreateDirectory($engine)
        Copy-Item -LiteralPath (Join-Path $engineSpec 'package.json'), (Join-Path $engineSpec 'package-lock.json') -Destination $engine
        Push-Location $engine
        $oldPath = $env:Path
        try {
            $env:Path = "$node;$oldPath"
            & (Join-Path $node 'node.exe') (Join-Path $node 'node_modules/npm/bin/npm-cli.js') ci --omit=dev --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Installing the locked Remotion engine failed.' }
        } finally { $env:Path = $oldPath; Pop-Location }
        [IO.File]::WriteAllText($engineStamp, $engineHash)
    }
    $lock.Dispose()
    if ($PrepareOnly) { Write-Host "Runtime and compiler are ready in $cache."; return }

    # Fresh, private staging prevents obsolete source files or an earlier interrupted
    # package from entering the installer. Never populate a user project directory.
    $build = Join-Path $cache ('builds/' + [Guid]::NewGuid().ToString('N'))
    $bundle = Join-Path $build 'MStudio'
    $runtime = Join-Path $bundle 'runtime'
    $brand = Join-Path $bundle 'app'
    $licenses = Join-Path $bundle 'licenses'
    foreach ($folder in @($runtime,$brand,$licenses)) { [void][IO.Directory]::CreateDirectory($folder) }
    & (Join-Path $PSScriptRoot 'build-mstudio.ps1') -OutputDir $bundle
    foreach ($file in @('hub-server.mjs','studio-server.mjs','studio-cli.mjs','hub.html','studio.html','medias.js','menubar.js','shortcuts.js','AGENT.md','AGENT.en.md','README.md','README.fr.md','LICENSE')) {
        Copy-Item -LiteralPath (Join-Path $root $file) -Destination $bundle
    }
    foreach ($folder in @('page','player','lib')) { Copy-Tree (Join-Path $root $folder) (Join-Path $bundle $folder) }
    $docs = Join-Path $bundle 'docs'
    [void][IO.Directory]::CreateDirectory($docs)
    foreach ($guide in @('RECONSTRUIRE-UNE-VIDEO-AVEC-REMOTION.md','FICHE-COULISSES-REMOTION.md','COULISSES-REMOTION-CONTRACT.md')) {
        Copy-Item -LiteralPath (Join-Path $root "docs/$guide") -Destination $docs
    }
    $screenshots = Join-Path $docs 'screenshots'
    [void][IO.Directory]::CreateDirectory($screenshots)
    Copy-Item -LiteralPath (Join-Path $root 'docs/screenshots/mstudio-reconstruction.jpg') -Destination $screenshots
    foreach ($file in @('mstudio.ico','mstudio.png')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $brand }
    Copy-Item -LiteralPath (Join-Path $brand 'mstudio.png') -Destination (Join-Path $bundle 'favicon.png')
    [IO.File]::WriteAllText((Join-Path $bundle 'mstudio.json'), (@{ name='MStudio'; version=$version } | ConvertTo-Json))
    foreach ($file in @('node.exe','npm','npm.cmd','npx','npx.cmd')) { Copy-Item -LiteralPath (Join-Path $node $file) -Destination $runtime }
    Copy-Tree (Join-Path $node 'node_modules/npm') (Join-Path $runtime 'node_modules/npm')
    Copy-Item -LiteralPath (Join-Path $node 'LICENSE') -Destination (Join-Path $licenses 'Node-LICENSE.txt')
    foreach ($file in @('ffmpeg.exe','ffprobe.exe')) { Copy-Item -LiteralPath (Join-Path $ffmpeg "bin/$file") -Destination $runtime }
    Get-ChildItem -LiteralPath (Join-Path $ffmpeg 'bin') -Filter '*.dll' -File | Copy-Item -Destination $runtime
    Copy-Item -LiteralPath (Join-Path $ffmpeg 'LICENSE') -Destination (Join-Path $licenses 'FFmpeg-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $ffmpeg 'README.txt') -Destination (Join-Path $licenses 'FFmpeg-README.txt')
    Copy-Tree $engine (Join-Path $bundle 'engine')
    $remotion = Join-Path $engine 'node_modules/remotion'
    Copy-Item -LiteralPath (Join-Path $remotion 'LICENSE.md') -Destination (Join-Path $licenses 'Remotion-LICENSE.md')
    Copy-Item -LiteralPath (Join-Path $remotion 'THIRD_PARTY_LICENSES.md') -Destination (Join-Path $licenses 'Remotion-THIRD-PARTY-LICENSES.md')
    Copy-Item -LiteralPath (Join-Path $definition 'THIRD-PARTY-NOTICES.txt') -Destination $licenses

    $compileDir = Join-Path $build 'release'
    [void][IO.Directory]::CreateDirectory($compileDir)
    $compiler = Join-Path $inno 'tools/ISCC.exe'
    $log = Join-Path $build 'compiler.log'
    & $compiler /Qp "/DProductVersion=$version" "/DSourceRoot=$bundle" "/DReleaseDir=$compileDir" "/DWebViewInstaller=$webview" (Join-Path $definition 'setup.iss') *> $log
    if ($LASTEXITCODE -ne 0) { Get-Content -Tail 18 -LiteralPath $log; throw "Installer compilation failed. See $log." }
    $name = "MStudio-Setup-$version-win-x64.exe"
    $setup = Join-Path $OutputDir $name
    $temporary = Join-Path $OutputDir "$name.$PID.tmp"
    Copy-Item -LiteralPath (Join-Path $compileDir $name) -Destination $temporary
    [IO.File]::Move($temporary, $setup, $true)
    $receipt = [ordered]@{version=$version; setup=$setup; sha256=(Get-FileHash -LiteralPath $setup).Hash; bytes=(Get-Item -LiteralPath $setup).Length; stagedBundle=$bundle}
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir 'MStudio-build.json') -Encoding utf8
    Write-Output ($receipt | ConvertTo-Json)
} finally { $lock.Dispose() }
