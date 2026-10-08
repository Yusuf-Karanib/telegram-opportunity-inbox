# Yusuf's Telegram Opportunity Inbox

A private Telegram bot for meaningful UAE-accessible jobs, internships, programs, competitions, hackathons, and events.

Paste or forward opportunity text. The bot creates a review draft, extracts only supported details, warns about likely duplicates, and waits for confirmation before saving. Unknown values stay empty.

The scout runs at **7:00 AM and 7:00 PM UAE time**. It checks official GDG pages and ten web-search groups covering official UAE sources, public LinkedIn posts, X, Instagram, Devpost, Meetup, Eventbrite, F6S, company program pages, and globally accessible opportunities. Use `/discover` to check immediately.

Public social posts are discovery leads, not proof. The bot labels them clearly and asks for an official application or registration page before recommending action. It does not log into social accounts or read private posts.

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

Discovered cards include a description, why the item may fit Yusuf, status, deadline, event date, cost, location, eligibility, restrictions, commitment, likely benefits, source quality, missing facts, a fit score, and an honest recommendation. Missing facts stay **Not stated**.

## Views

Use `/inbox` for Saved/Planning, Upcoming, Overdue, Waiting, Registered, Accepted, Rejected, Completed, and Archived views.

## Important safety rule

Pasted text never changes an item's status to applied, registered, accepted, or completed. Yusuf must confirm status with a button or `/status` command.

Dates are filled only when a clear label is present, such as `Deadline:` or `Event:`. Unlabelled dates are shown as possible dates but are not assigned.

The scout filters out expired or closed listings, technical news, security alerts, completion posts, and likely duplicates. A social or third-party result may be delivered as an **Investigate first** lead, but only an organizer-owned page can be labelled official.

## Cost and stack

- Telegram bot
- Supabase Free database, Edge Functions, and schedule
- Brave Search API for broad public web and social-page discovery
- Rule-based verification and extraction; no LLM API required

The ten searches run twice daily, or about 600 searches in a 30-day month. Check Brave's current plan and credit requirements before enabling it. Search results are provided by [Brave Search API](https://brave.com/search/api/).

The package reuses the safe deployment pattern from the AI News Inbox but is a separate bot. Telegram allows only one webhook per bot token, so do not reuse the AI News bot token unless both products are deliberately merged later.

Start with [SETUP.md](SETUP.md).
