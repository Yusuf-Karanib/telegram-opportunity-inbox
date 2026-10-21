# Yusuf's Telegram Opportunity Inbox

A private Telegram bot for meaningful UAE-accessible jobs, internships, programs, competitions, hackathons, and events.

Paste or forward opportunity text. The bot creates a review draft, extracts only supported details, warns about likely duplicates, and waits for confirmation before saving. Unknown values stay empty.

The scout runs at **7:00 AM and 7:00 PM UAE time**. Every run checks direct official pages for GDG UAE chapters, Dubai Future Foundation, Hub71, startAD, MBZUAI AI Nexus, ChallengeON, 42 Abu Dhabi, NASA Space Apps UAE, AI for Good, and Dubai Future Forum. It also runs fifteen English and Arabic public web searches across UAE organizations, universities, communities, platforms, and indexed social posts. Use `/discover` to run the same check immediately.

When a scheduled search finds nothing new, the bot sends one short confirmation instead of staying silent.

Public social posts are discovery leads, not proof. They are sent only when they clearly say applications or registration are open and include a future date. The bot checks recent social results each run, but it does not log into social accounts or read private or unindexed posts.

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

Discovery cards are intentionally short: title, organization/category, a brief description, and only useful known facts such as date, location, cost, eligibility, restrictions, and commitment. Unknown fields, scores, repeated warnings, and source-analysis text are hidden.

The human-readable retained list is [OPPORTUNITY_TRACKER.md](OPPORTUNITY_TRACKER.md). Its items are also seeded into the private Telegram inbox as `Saved`, never as applied or registered.

## Views

Use `/inbox` for Saved/Planning, Upcoming, Overdue, Waiting, Registered, Accepted, Rejected, Completed, and Archived views.

## Important safety rule

Pasted text never changes an item's status to applied, registered, accepted, or completed. Yusuf must confirm status with a button or `/status` command.

Dates are filled only when a clear label is present, such as `Deadline:` or `Event:`. Unlabelled dates are shown as possible dates but are not assigned.

The scout filters out expired or closed listings, articles, guides, technical news, security alerts, completion posts, invite-only items, and likely duplicates. Ordinary third-party articles are not delivered. Public social and opportunity-platform listings require an explicit open status and a future date.

## Cost and stack

- Telegram bot
- Supabase Free database, Edge Functions, and schedule
- Brave Search API for broad public web and social-page discovery
- Direct checks of selected official pages and the official ChallengeON feed
- Rule-based verification and extraction; no LLM API required

The fifteen searches run twice daily, or about 900 searches in a 30-day month and 930 in a 31-day month. This stays within the current 1,000-request monthly credit, but leaves room for only a few manual `/discover` runs. Check Brave's current plan and credit requirements before enabling it. Search results are provided by [Brave Search API](https://brave.com/search/api/).

The package reuses the safe deployment pattern from the AI News Inbox but is a separate bot. Telegram allows only one webhook per bot token, so do not reuse the AI News bot token unless both products are deliberately merged later.

Start with [SETUP.md](SETUP.md).
