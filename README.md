# Yusuf's Telegram Opportunity Inbox

A private Telegram bot for meaningful UAE-accessible jobs, internships, programs, competitions, hackathons, and events.

Paste or forward opportunity text. The bot creates a review draft, extracts only supported details, warns about likely duplicates, and waits for confirmation before saving. Unknown values stay empty.

The daily scout checks the official GDG Abu Dhabi, Sharjah, and Dubai pages at 8:00 AM UAE time. New future technology events arrive in Telegram with **Save**, **Dismiss**, and **Open official source** buttons. Use `/discover` to check immediately.

The bot classifies every message first. Technical news, security alerts, completion posts, and unclear items cannot be saved as opportunities unless Yusuf manually changes them to a real opportunity category.

## What it tracks

- Opportunity name and organization
- Category and source link
- Date discovered
- Application or registration status
- Deadline and event date
- Next action and reminder date
- Notes and outcome
- Course activity

Verified search details such as cost, location, eligibility, restrictions, access, and date checked can be pasted with labels. This MVP keeps them in Notes rather than inventing missing facts.

## Views

Use `/inbox` for Saved/Planning, Upcoming, Overdue, Waiting, Registered, Accepted, Rejected, Completed, and Archived views.

## Important safety rule

Pasted text never changes an item's status to applied, registered, accepted, or completed. Yusuf must confirm status with a button or `/status` command.

Dates are filled only when a clear label is present, such as `Deadline:` or `Event:`. Unlabelled dates are shown as possible dates but are not assigned.

The scout reads only selected official pages. It records the check date and leaves missing cost, eligibility, and restrictions as `Not stated`. It does not treat search snippets, news, or completion posts as opportunities. Expansion to more sources must follow [SEARCH_CRITERIA.md](SEARCH_CRITERIA.md).

## Cost and stack

- Telegram bot
- Supabase Free database, Edge Functions, and schedule
- Rule-based extraction included
- No AI API required

The package reuses the safe deployment pattern from the AI News Inbox but is a separate bot. Telegram allows only one webhook per bot token, so do not reuse the AI News bot token unless both products are deliberately merged later.

Start with [SETUP.md](SETUP.md).
