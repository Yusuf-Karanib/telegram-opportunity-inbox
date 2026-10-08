$ErrorActionPreference = 'Stop'

function New-RandomSecret {
    $bytes = [byte[]]::new(32)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Write-Host "OPPORTUNITY_TELEGRAM_WEBHOOK_SECRET=$(New-RandomSecret)"
Write-Host 'Save this in Supabase, then close this window. Do not put it in a project file.'

