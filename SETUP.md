# Setup

Use a new Telegram bot and a new Supabase Free project for the first trial. This avoids changing the working AI News Inbox.

You need:

1. Telegram.
2. A free Supabase account.
3. Node.js 22.6 or newer on the setup computer.

No AI API or paid service is required.

## 1. Create the Telegram bot

1. Open Telegram and message `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Keep the token private.
4. Open the new bot and send `/start`.

Do not reuse the AI News bot token. A Telegram bot can have only one webhook.

In PowerShell, open this package and run:

```powershell
./tools/get-telegram-ids.ps1
```

Enter the token only when asked. Save the displayed user ID and chat ID.

## 2. Create the Supabase project

1. Create a Free project at [Supabase](https://supabase.com/dashboard).
2. Copy its project reference from project settings.
3. Keep the database password private.

## 3. Deploy the private database and two functions

Run:

```powershell
./tools/deploy.ps1
```

Enter the project reference and sign in when Supabase opens the browser.

## 4. Create the private secrets

Fast path: run this single script. It configures the secrets and Telegram, then opens
the SQL Editor with the reminder setup already copied to your clipboard:

```powershell
./tools/finish-setup.ps1
```

Paste into the opened SQL Editor and click **Run**, then continue at step 7.

Manual path:

Run:

```powershell
./tools/make-secrets.ps1
```

In Supabase, open **Project Settings > Edge Functions > Secrets** and add:

| Name | Value |
|---|---|
| `OPPORTUNITY_TELEGRAM_BOT_TOKEN` | New token from BotFather |
| `OPPORTUNITY_TELEGRAM_CHAT_ID` | Chat ID from step 1 |
| `OPPORTUNITY_TELEGRAM_ALLOWED_USER_ID` | User ID from step 1 |
| `OPPORTUNITY_TELEGRAM_WEBHOOK_SECRET` | Generated webhook secret |

Do not save real secrets in this package or send them in chat.

## 5. Turn on reminders

1. Open `supabase/setup_schedule.sql`.
2. Copy it into Supabase **SQL Editor**.
3. Replace only `YOUR_PROJECT_REF` with the project reference.
4. Run it once.
5. Copy the returned value into a new Edge Function secret named `OPPORTUNITY_CRON_SECRET`.

The worker checks every 15 minutes. It records each delivery so the same reminder is not sent twice. Failed deliveries are tried at most three times. An uncertain Telegram delivery is not retried because that could create a duplicate message.

Processed bot updates are kept for 90 days and reminder delivery records for 180 days, then cleaned automatically.

## 6. Connect Telegram

Run:

```powershell
./tools/set-telegram-webhook.ps1
```

Enter the new bot token, project reference, and the same webhook secret from step 4.

## 7. Test

Send this to the bot:

```text
Opportunity: UAE Robotics Challenge
Organization: Example Labs
Category: competition
Deadline: 30 September 2026
Cost: Free
Location: Abu Dhabi
Eligibility: UAE residents aged 18+
Access: Public
Date checked: 19 September 2026
Next action: Check eligibility
Original source: https://example.com/robotics?utm_source=test
```

The bot must show a draft with status **Saved only — not applied or registered**. Tap **Save**, then `/inbox`.

Then send `AWS Security Bulletin CVE-2026-12345`. It must classify the message as a security alert and must not show a Save button.

Send `/discover` to run the official-source scout immediately. It also runs automatically every day at 8:00 AM UAE time.

Run local checks with:

```powershell
./tools/run-tests.ps1
```

## Supported date input

- `2026-10-15`
- `2026-10-15 5pm`
- `15/10/2026 17:00`
- `15 October 2026`
- `tomorrow 9am`

Date-only values remain labelled as date-only. Internally, deadline and event dates are checked at the end of that Dubai calendar day, but the bot does not display that as a claimed time. Date-only reminders and next actions are checked at 9:00 AM Dubai time.

## Stop reminders

Run this in Supabase SQL Editor:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'opportunity-inbox-reminders-15m';
```

This stops reminders without deleting any opportunity.
