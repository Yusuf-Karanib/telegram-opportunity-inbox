# Verification

Checked on 26 October 2026, UAE time.

- 103 automated tests passed, including regression cases from the real Telegram inbox.
- Deno type checks passed for opportunity-bot, opportunity-discovery, and opportunity-reminders.
- The final streaming page reader completed a full live preview in about 44 seconds. The earlier DOM reader was rejected after a preview exceeded the free worker's compute limit.
- A full live search completed in about 69 seconds: 17 official sources, 15 public web/social queries, and 283 unique result/page URLs. It refreshed 15 existing cards and recorded blocked or missing pages as source errors.
- An independent maintenance run refreshed the 15 remaining cards, withdrew one additional news article, and finished without source errors.
- Simultaneous live invocations are blocked by the database run claim. Repeated manual searches return recent_manual_run during the ten-minute cooldown.
- Anonymous and ordinary authenticated clients cannot read the run history or claim searches.
- Eight saved opportunities were preserved. Search cleanup only changes suggestion records and their Telegram cards.
- The schedule remains 7:00 AM and 7:00 PM UAE time. /health reads recorded search outcomes; internal previews and maintenance are excluded.
- Extra suitable matches are stored in a private queue. A delivery cap of five no longer discards the sixth match. Queued official items are checked again before later delivery.
- User dismissals and saved application statuses are preserved. Suggestions are never automatically registered, applied to, or purchased.
- New official-source cards require a current page or official feed. Social and platform leads require explicitly open applications/registration and a future date.
- The reader excludes website menus, hidden dialogs, speaker biographies, related programme cards, chatbots, and venue directions. Price tiers, VAT wording, end dates, and conflicting date claims are preserved.
- No credentials are stored in the repository. Search/API credentials remain in Supabase secrets.

See [AUDIT.md](AUDIT.md) for the findings and the remaining coverage limits.
