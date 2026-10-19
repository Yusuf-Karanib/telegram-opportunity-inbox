# Verification

Checked on 19 October 2026.

- 77 of 77 automated tests passed.
- Classification tests cover CVE bulletins, technical news, completion posts, unclear items, competitions, and cybersecurity hackathons.
- Broad discovery tests cover official UAE pages, English and Arabic results, recent public social leads, fifteen web-search groups, direct official listings, MBZUAI AI Nexus events, ChallengeON deadlines, school-only exclusions, startup hubs, platform listings, expired events, source quality, and compact cards.
- The new schedule is 7:00 AM and 7:00 PM UAE time.
- Every morning checks page one; evening runs rotate across pages two through four, avoiding repeated top results without increasing API usage.
- Empty scheduled runs report successful official sources, public searches, and unique pages instead of presenting repeated raw hits as opportunities.
- Links dismissed by the automatic quality reset can be reconsidered by the stricter current filters; Yusuf's own dismissals remain blocked.
- All 9 PowerShell setup scripts parsed successfully.
- The locked Supabase CLI version is 2.116.0 and its deploy options were verified.
- No real Telegram or Supabase credentials are stored in this package.
- The final package excludes `.env`, `node_modules`, and local Supabase temporary files.

The broad scout, compact cards, stricter verification rules, and twice-daily schedule are live in Supabase.

## Final live check

The live check completed 13 official-source checks and all 15 public web/social searches without source errors. It reviewed 273 unique pages, removed one Hub71 card whose page said applications were closed, and sent five dated official cards from MBZUAI and ChallengeON. Every suggestion still requires **Save**; the scout never silently adds an item.
