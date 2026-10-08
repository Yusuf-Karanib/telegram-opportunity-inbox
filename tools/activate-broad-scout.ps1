$ErrorActionPreference = 'Stop'

$projectRef = 'tpamofqfvnxoymadbgcr'
$packageRoot = Split-Path -Parent $PSScriptRoot
$supabaseCli = Join-Path $packageRoot 'node_modules\supabase\dist\supabase.js'
Set-Location -LiteralPath $packageRoot

if (-not (Test-Path -LiteralPath $supabaseCli)) {
    throw 'The Supabase setup tool is missing. Run npm install in this folder, then try again.'
}

function Read-SecretText([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Write-Host 'Sign in to the Supabase account that owns project tpamofqfvnxoymadbgcr.'
& node.exe $supabaseCli login --agent no --output-format text
if ($LASTEXITCODE -ne 0) { throw 'Supabase sign-in did not finish.' }

& node.exe $supabaseCli link --project-ref $projectRef
if ($LASTEXITCODE -ne 0) {
    throw 'This Supabase account cannot access the Opportunity Inbox project. Sign in with the account that created it.'
}

& node.exe $supabaseCli db push --yes
if ($LASTEXITCODE -ne 0) { throw 'The broad-scout database upgrade failed.' }

foreach ($functionName in @('opportunity-bot', 'opportunity-reminders', 'opportunity-discovery')) {
    & node.exe $supabaseCli functions deploy $functionName --project-ref $projectRef --use-api --no-verify-jwt
    if ($LASTEXITCODE -ne 0) { throw "Deploying $functionName failed." }
}

Write-Host ''
Write-Host 'Create a Search API key at https://brave.com/search/api/ if you do not already have one.'
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
}
finally {
    if (Test-Path -LiteralPath $temporarySecretsFile) {
        Remove-Item -LiteralPath $temporarySecretsFile -Force
    }
    $apiKey = $null
}

Write-Host ''
Write-Host 'The broad scout is live. It will run at 7:00 AM and 7:00 PM UAE time.'
Write-Host 'Send /discover to the Telegram bot for an immediate test.'
