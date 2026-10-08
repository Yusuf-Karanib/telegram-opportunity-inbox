$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $packageRoot

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22.6 or newer is required.'
}
$nodeParts = (& node.exe --version).TrimStart('v').Split('.')
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 6)) {
    throw 'Node.js 22.6 or newer is required.'
}

$supabaseCli = Join-Path $packageRoot 'node_modules\supabase\dist\supabase.js'
if (-not (Test-Path -LiteralPath $supabaseCli)) {
    Write-Host 'Installing the pinned Supabase setup tool in this folder...'
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Supabase tool installation failed.' }
}

$projectRef = (Read-Host 'Paste the new Supabase project reference').Trim()
if ($projectRef -notmatch '^[a-z0-9]{10,40}$') {
    throw 'That project reference does not look valid.'
}

Write-Host 'Sign in to Supabase when the browser opens.'
& node.exe $supabaseCli login
if ($LASTEXITCODE -ne 0) { throw 'Supabase sign-in failed.' }
& node.exe $supabaseCli link --project-ref $projectRef
if ($LASTEXITCODE -ne 0) { throw 'Linking the Supabase project failed.' }
& node.exe $supabaseCli db push
if ($LASTEXITCODE -ne 0) { throw 'The database migration failed.' }
& node.exe $supabaseCli functions deploy opportunity-bot --project-ref $projectRef --use-api --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'Deploying the Telegram bot failed.' }
& node.exe $supabaseCli functions deploy opportunity-reminders --project-ref $projectRef --use-api --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'Deploying the reminder worker failed.' }
& node.exe $supabaseCli functions deploy opportunity-discovery --project-ref $projectRef --use-api --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'Deploying the opportunity scout failed.' }

Write-Host 'Deployment finished. Continue at step 4 in SETUP.md.'
