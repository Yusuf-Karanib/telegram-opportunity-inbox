$ErrorActionPreference = 'Stop'

$projectRef = 'tpamofqfvnxoymadbgcr'
$packageRoot = Split-Path -Parent $PSScriptRoot
$supabaseCli = Join-Path $packageRoot 'node_modules\supabase\dist\supabase.js'

if (-not (Test-Path -LiteralPath $supabaseCli)) {
    throw 'Run deploy.ps1 first.'
}

function Read-SecretText([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$apiKey = Read-SecretText 'Paste the Brave Search API key'
if ($apiKey.Length -lt 20 -or $apiKey -match '\s') {
    throw 'That Brave Search API key does not look valid.'
}

$temporarySecretsFile = Join-Path ([IO.Path]::GetTempPath()) ("opportunity-scout-{0}.env" -f [guid]::NewGuid())
try {
    [IO.File]::WriteAllLines(
        $temporarySecretsFile,
        @("OPPORTUNITY_BRAVE_SEARCH_API_KEY=$apiKey"),
        [Text.Encoding]::ASCII
    )
    & node.exe $supabaseCli secrets set --env-file $temporarySecretsFile --project-ref $projectRef
    if ($LASTEXITCODE -ne 0) { throw 'Saving the search key failed.' }
    Write-Host 'Broad web and public social search is configured.'
}
finally {
    if (Test-Path -LiteralPath $temporarySecretsFile) {
        Remove-Item -LiteralPath $temporarySecretsFile -Force
    }
    $apiKey = $null
}
