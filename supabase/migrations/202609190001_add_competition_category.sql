-- Add the competition category for projects deployed before 19 September 2026.
-- News, security alerts, completion posts, and unclear drafts are classified by
-- the bot but intentionally cannot be stored as opportunities.

alter table public.opportunities
  drop constraint if exists opportunities_category_check;

alter table public.opportunities
  add constraint opportunities_category_check check (
    category in (
      'job', 'internship', 'course', 'program',
      'competition', 'hackathon', 'event', 'other'
    )
  );
