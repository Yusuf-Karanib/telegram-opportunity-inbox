$ErrorActionPreference = 'Stop'

function Read-SecretText([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$botToken = Read-SecretText 'Paste the new Opportunity Inbox Telegram bot token'
try {
    $result = Invoke-RestMethod -Method Get -Uri "https://api.telegram.org/bot$botToken/getWebhookInfo"
    if (-not $result.ok) { throw 'Telegram rejected the request.' }
    $result.result | Select-Object url, pending_update_count, last_error_date, last_error_message
}
finally {
    $botToken = $null
}

