$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$nodeParts = (& node.exe --version).TrimStart('v').Split('.')
if ([int]$nodeParts[0] -lt 22 -or ([int]$nodeParts[0] -eq 22 -and [int]$nodeParts[1] -lt 6)) {
    throw 'Node.js 22.6 or newer is required to run these checks.'
}
$testFiles = @(Get-ChildItem -LiteralPath (Join-Path $packageRoot 'tests') -Filter '*.test.ts' |
    ForEach-Object { $_.FullName })
& node.exe --experimental-strip-types --test $testFiles
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
