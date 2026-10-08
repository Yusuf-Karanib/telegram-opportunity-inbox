# One-screen MVP

The Telegram chat is the inbox. `/inbox` shows one dashboard with buttons for:

- Upcoming
- Saved / planning
- Overdue
- Waiting for a response
- Registered
- Accepted
- Rejected
- Completed
- Archived

## Fast daily flow

1. The scout checks GDG Abu Dhabi, Sharjah, and Dubai every day at 8:00 AM UAE time.
2. Review new verified suggestions, then tap **Save** or **Dismiss**.
3. Paste or forward other opportunities manually.
4. The bot extracts only details present in the message.
5. Use the saved card to confirm status, dates, next action, or an outcome.

The bot never marks an application as submitted or a registration as complete from pasted text. Only a status button or `/status` command can do that.

Technical news, security alerts, completion posts, and unclear items have no Save button. Yusuf must change the category manually only when the message contains a real opportunity.

## Deliberately excluded

- No website or mobile app.
- No broad or arbitrary web scraping; only selected official sources.
- No email, calendar, or job-board integrations.
- No paid AI requirement.
- No automatic application submission.

This keeps the first version cheap, private, and small enough to use immediately.
