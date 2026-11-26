[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../dist/tizen')
)

$ErrorActionPreference = 'Stop'
$version = '1.7.4'
$integrity = '3GlxGdPvT2YHvQYOt+yOzT/DEior/qJVNIylHA77kgeoBTdQQqi70GwefNEUmHQeNGyjC8U62+bruqW/Tpm+tg=='
$buildRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('streamtube-tizen-' + [guid]::NewGuid())
$bundle = Join-Path $buildRoot 'widget'
$archive = Join-Path $buildRoot 'hls.tgz'

New-Item -ItemType Directory -Path $buildRoot | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'widget') -Destination $bundle -Recurse
    $download = @'
const fs = require('node:fs');
const crypto = require('node:crypto');

async function main() {
  const [version, expected, output] = process.argv.slice(2);
  const response = await fetch('https://registry.npmjs.org/hls.js/-/hls.js-' + version + '.tgz');
  if (!response.ok) throw new Error('HLS.js download failed: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha512').update(bytes).digest('base64') !== expected) {
    throw new Error('HLS.js checksum mismatch');
  }
  fs.writeFileSync(output, bytes);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
'@
    $downloadScript = Join-Path $buildRoot 'download.cjs'
    $download | Set-Content -LiteralPath $downloadScript -Encoding UTF8
    node $downloadScript $version $integrity $archive
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the pinned HLS.js package.' }
    tar -xf $archive -C $buildRoot package/dist/hls.min.js
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract HLS.js.' }

    $vendor = Join-Path $bundle 'vendor'
    New-Item -ItemType Directory -Path $vendor | Out-Null
    Copy-Item -LiteralPath (Join-Path $buildRoot 'package/dist/hls.min.js') -Destination $vendor
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'hls.LICENSE') -Destination $vendor

    [xml]$manifest = Get-Content -LiteralPath (Join-Path $bundle 'config.xml') -Raw
    $widgetName = "StreamTube-TV-$($manifest.widget.version).wgt"
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $builtWidget = Join-Path $buildRoot $widgetName
    $widget = [System.IO.Compression.ZipFile]::Open($builtWidget, 'Create')
    try {
        foreach ($file in Get-ChildItem -LiteralPath $bundle -Recurse -File) {
            $entryName = $file.FullName.Substring($bundle.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($widget, $file.FullName, $entryName) | Out-Null
        }
    } finally {
        $widget.Dispose()
    }
    $destination = Join-Path (Resolve-Path -LiteralPath $OutputDirectory) $widgetName
    Move-Item -LiteralPath $builtWidget -Destination $destination -Force
    Write-Output $destination
} finally {
    $resolvedRoot = (Resolve-Path -LiteralPath $buildRoot).Path
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedRoot.StartsWith((Join-Path $tempRoot 'streamtube-tizen-'), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    }
}
