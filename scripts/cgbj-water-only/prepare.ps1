[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$BaselineCache,
    [Parameter(Mandatory)][string]$RepairedCache,
    [Parameter(Mandatory)][string]$Destination
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json

function Assert-FileHash($Path, $Expected) {
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actual -ne $Expected) { throw "Unexpected SHA-256 for $Path" }
}

function Assert-CacheHash($Root, $Expected) {
    $Root = (Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd('\')
    [string[]]$rows = @(Get-ChildItem -LiteralPath $Root -File -Force -Recurse | ForEach-Object {
        $path = $_.FullName.Substring($Root.Length + 1).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$path $hash"
    })
    [Array]::Sort($rows, [StringComparer]::Ordinal)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($rows -join [char]10)
        $actual = [BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-', '')
    } finally {
        $sha256.Dispose()
    }
    if ($rows.Count -ne $Expected.files -or $actual -ne $Expected.sha256) {
        throw "Cache does not match the pinned file set at $Root"
    }
}

$baseline = (Resolve-Path -LiteralPath $BaselineCache).ProviderPath
$repaired = (Resolve-Path -LiteralPath $RepairedCache).ProviderPath
$destinationPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw "Destination already exists: $destinationPath" }

$parent = (Resolve-Path -LiteralPath (Split-Path -Parent $destinationPath)).ProviderPath
$stage = Join-Path $parent ('.cgbj-water-only-' + [Guid]::NewGuid().ToString('N'))

Assert-FileHash $Executable $manifest.executable.sha256
Assert-CacheHash $baseline $manifest.baseCache
foreach ($shader in $manifest.shaders) {
    Assert-FileHash (Join-Path $repaired $shader.cachePath) $shader.sha256
}

Copy-Item -LiteralPath $baseline -Destination $stage -Recurse -Force
foreach ($shader in $manifest.shaders) {
    $target = Join-Path $stage $shader.cachePath
    [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repaired $shader.cachePath) -Destination $target -Force
}
Assert-CacheHash $stage $manifest.preparedCache
[IO.Directory]::Move($stage, $destinationPath)
Write-Output $destinationPath
