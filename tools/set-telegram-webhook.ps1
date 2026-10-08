$ErrorActionPreference = 'Stop'

function Read-SecretText([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$projectRef = (Read-Host 'Paste the new Supabase project reference').Trim()
if ($projectRef -notmatch '^[a-z0-9]{10,40}$') {
    throw 'That project reference does not look valid.'
}
$botToken = Read-SecretText 'Paste the new Opportunity Inbox Telegram bot token'
$webhookSecret = Read-SecretText 'Paste OPPORTUNITY_TELEGRAM_WEBHOOK_SECRET'
if ($webhookSecret.Length -lt 20 -or $webhookSecret.Length -gt 256 -or
    $webhookSecret -notmatch '^[A-Za-z0-9_-]+$') {
    throw 'The webhook secret must be 20-256 characters using letters, numbers, _ or -.'
}

try {
    $webhookUrl = "https://$projectRef.supabase.co/functions/v1/opportunity-bot"
    $body = @{
        url = $webhookUrl
        secret_token = $webhookSecret
        allowed_updates = '["callback_query","message"]'
        drop_pending_updates = 'false'
    }
    $response = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$botToken/setWebhook" -Body $body
    if (-not $response.ok) { throw 'Telegram rejected the webhook.' }
    Write-Host "Opportunity Inbox is connected to $webhookUrl"
}
finally {
    $botToken = $null
    $webhookSecret = $null
}

