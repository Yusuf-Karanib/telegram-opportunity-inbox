# Test plan

## Classification safety

- An AWS CVE or security bulletin becomes `security_alert` and has no Save button.
- Product release notes become `technical_news` and have no Save button.
- A LinkedIn-style completion post becomes `completion_post` and has no Save button.
- An unclear item becomes `other` and requires a manual category.
- A competition, hackathon, event, program, job, internship, or course can be saved after review.
- Cost, location, eligibility, restrictions, access, and date-checked labels remain visible in Notes.
- Closed, finished, invite-only, and missing-eligibility research results are clearly labelled and never guessed.

## Automated

- Future and Dubai-time date parsing
- Date-only versus exact-time display
- No status extraction from pasted text
- Unlabelled dates remain unassigned
- Link cleanup and duplicate scoring
- Commands and status aliases
- Upcoming, overdue, waiting, and archived views
- Deadline, event, manual, next-action, and course-inactivity reminders
- Telegram HTML escaping and callback length
- Static checks for private database access, webhook authentication, update replay protection, and reminder claims

## Manual after deployment

1. Unauthorized Telegram users receive no bot data.
2. The same Telegram update ID changes data only once.
3. Paste, review, edit, save, and cancel drafts.
4. Save two similar items and verify the warning does not force a merge.
5. Confirm every status button.
6. Check `/inbox` view counts.
7. Create a reminder 20 minutes ahead and confirm one message arrives.
8. Snooze the reminder and confirm its date changes.
9. Mark course activity and verify the inactivity clock resets.
10. Archive and restore an item.
