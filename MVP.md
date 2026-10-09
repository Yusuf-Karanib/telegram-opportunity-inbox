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

## Fast twice-daily flow

1. The scout checks official pages and ten public web/social search groups at 7:00 AM and 7:00 PM UAE time.
2. Review the short description and any known date, location, cost, eligibility, restrictions, or commitment.
3. Tap **Save**, **Dismiss**, or open the source.
4. Paste or forward other opportunities manually.
5. The bot extracts only details present in the message.
6. Use the saved card to confirm status, dates, next action, or an outcome.

The bot never marks an application as submitted or a registration as complete from pasted text. Only a status button or `/status` command can do that.

Technical news, security alerts, completion posts, and unclear items have no Save button. Yusuf must change the category manually only when the message contains a real opportunity.

## Deliberately excluded

- No website or mobile app.
- No login-based scraping of LinkedIn, X, or Instagram. Only public pages visible to the search index are considered.
- No email, calendar, or job-board integrations.
- No LLM API requirement.
- No automatic application submission.

This keeps the first version controlled while adding broad discovery. Social and third-party results remain leads until an official page confirms them.
