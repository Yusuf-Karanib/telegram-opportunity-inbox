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

$botToken = Read-SecretText 'Paste the new Opportunity Inbox Telegram bot token'
try {
    $response = Invoke-RestMethod -Method Get -Uri "https://api.telegram.org/bot$botToken/getUpdates"
    if (-not $response.ok) { throw 'Telegram rejected the request.' }
    $privateMessages = @($response.result | Where-Object {
        $_.message -and $_.message.chat.type -eq 'private'
    })
    if ($privateMessages.Count -eq 0) {
        throw 'No private message was found. Open the new bot, send /start, then run this again.'
    }
    $latest = $privateMessages[-1].message
    Write-Host "Telegram user ID: $($latest.from.id)"
    Write-Host "Telegram chat ID: $($latest.chat.id)"
}
finally {
    $botToken = $null
}

