$ErrorActionPreference = 'Stop'

$projectRef = 'tpamofqfvnxoymadbgcr'
$telegramUserId = '7013092918'
$telegramChatId = '7013092918'
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

function New-RandomSecret {
    $bytes = [byte[]]::new(32)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) }
    finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$botToken = Read-SecretText 'Paste the new Opportunity Inbox Telegram bot token'
if ($botToken -notmatch '^\d{6,15}:[A-Za-z0-9_-]{30,100}$') {
    throw 'That Telegram bot token does not look valid.'
}

$webhookSecret = New-RandomSecret
$cronSecret = New-RandomSecret
$temporarySecretsFile = Join-Path ([IO.Path]::GetTempPath()) ("opportunity-inbox-secrets-{0}.env" -f [guid]::NewGuid())

try {
    $secretLines = @(
        "OPPORTUNITY_TELEGRAM_BOT_TOKEN=$botToken"
        "OPPORTUNITY_TELEGRAM_CHAT_ID=$telegramChatId"
        "OPPORTUNITY_TELEGRAM_ALLOWED_USER_ID=$telegramUserId"
        "OPPORTUNITY_TELEGRAM_WEBHOOK_SECRET=$webhookSecret"
        "OPPORTUNITY_CRON_SECRET=$cronSecret"
    )
    [IO.File]::WriteAllLines($temporarySecretsFile, $secretLines, [Text.Encoding]::ASCII)

    & node.exe $supabaseCli secrets set --env-file $temporarySecretsFile --project-ref $projectRef
    if ($LASTEXITCODE -ne 0) { throw 'Saving the Supabase secrets failed.' }

    $webhookUrl = "https://$projectRef.supabase.co/functions/v1/opportunity-bot"
    $body = @{
        url = $webhookUrl
        secret_token = $webhookSecret
        allowed_updates = '["callback_query","message"]'
        drop_pending_updates = 'false'
    }
    $response = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$botToken/setWebhook" -Body $body
    if (-not $response.ok) { throw 'Telegram rejected the webhook.' }

    $scheduleSql = @"
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

do `$`$
declare
  v_secret_id uuid;
begin
  select id into v_secret_id from vault.decrypted_secrets
  where name = 'opportunity_inbox_project_url' order by created_at desc limit 1;
  if v_secret_id is null then
    perform vault.create_secret('https://$projectRef.supabase.co', 'opportunity_inbox_project_url');
  else
    perform vault.update_secret(v_secret_id, 'https://$projectRef.supabase.co', 'opportunity_inbox_project_url');
  end if;

  v_secret_id := null;
  select id into v_secret_id from vault.decrypted_secrets
  where name = 'opportunity_inbox_cron_secret' order by created_at desc limit 1;
  if v_secret_id is null then
    perform vault.create_secret('$cronSecret', 'opportunity_inbox_cron_secret');
  else
    perform vault.update_secret(v_secret_id, '$cronSecret', 'opportunity_inbox_cron_secret');
  end if;
end;
`$`$;

do `$`$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'opportunity-inbox-reminders-15m'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'opportunity-inbox-reminders-15m',
    '*/15 * * * *',
    `$command`$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
          where name = 'opportunity_inbox_project_url' order by created_at desc limit 1)
          || '/functions/v1/opportunity-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
            where name = 'opportunity_inbox_cron_secret' order by created_at desc limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    `$command`$
  );
end;
`$`$;

select jobid, jobname, schedule
from cron.job
where jobname = 'opportunity-inbox-reminders-15m';
"@

    Set-Clipboard -Value $scheduleSql
    Start-Process "https://supabase.com/dashboard/project/$projectRef/sql/new"
    Write-Host ''
    Write-Host 'Telegram is connected.'
    Write-Host 'The reminder setup is on your clipboard and the SQL Editor is opening.'
    Write-Host 'Press Ctrl+V, then click Run.'
}
finally {
    if (Test-Path -LiteralPath $temporarySecretsFile) {
        Remove-Item -LiteralPath $temporarySecretsFile -Force
    }
    $botToken = $null
    $webhookSecret = $null
    $cronSecret = $null
}
