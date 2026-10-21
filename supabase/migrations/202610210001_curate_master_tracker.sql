-- Yusuf's retained opportunity master list, verified from official sources on
-- 21 October 2026. New rows are Saved only: never applied or registered.

create temporary table opportunity_master_seed (
  name text not null,
  organization text not null,
  normalized_name text not null,
  normalized_organization text not null,
  name_match text not null,
  category text not null,
  source_url text not null,
  source_text text not null,
  deadline_at timestamptz,
  deadline_raw text,
  deadline_precision text,
  event_at timestamptz,
  event_raw text,
  event_precision text,
  next_action text not null,
  reminder_at timestamptz,
  reminder_raw text,
  reminder_precision text,
  notes text not null
) on commit drop;

insert into opportunity_master_seed values
(
  'NASA Space Apps Challenge 2026',
  'NASA',
  'nasa space apps challenge 2026',
  'nasa',
  '^nasa space apps challenge 2026',
  'hackathon',
  'https://www.spaceappschallenge.org/2026/',
  'Official 2026 global registration is open. Event: 14-15 November 2026. Registration remains open until the hackathon closes. Project submission closes 15 November at 11:59 PM local time. Teams may have up to six people.',
  '2026-11-15 23:59:00+04',
  '15 November 2026, 11:59 PM local time',
  'datetime',
  '2026-11-14 00:00:00+04',
  '14-15 November 2026',
  'date',
  'Choose Abu Dhabi, Fujairah, or the virtual Universal Event; then register and form or join a team.',
  '2026-10-24 09:00:00+04',
  '24 October 2026, 9:00 AM UAE time',
  'datetime',
  'Officially confirmed: global registration is open; all ages, backgrounds, and skill levels are welcome; teams have no more than six members. Under-18s require a parent or guardian. UAE pages exist for Abu Dhabi and Fujairah, but venue and local acceptance details are not stated. Universal is the confirmed virtual fallback. Cost appears free from official Space Apps pages, but UAE-specific incidental costs are not stated. The reminder is Yusuf''s planning date, not an official deadline.'
),
(
  'MBZUAI Agentic AI Security Symposium',
  'MBZUAI',
  'mbzuai agentic ai security symposium',
  'mbzuai',
  '(mbzuai )?agentic ai security symposium',
  'event',
  'https://ai-nexus.mbzuai.ac.ae/',
  'The official MBZUAI Nexus listing says REGISTRATION OPEN and provides a Register Your Interest action. Event: 11-12 November 2026 at MBZUAI, Masdar City, Abu Dhabi.',
  null,
  null,
  null,
  '2026-11-11 00:00:00+04',
  '11-12 November 2026',
  'date',
  'Review the official interest form and decide whether to submit it; attendance is not confirmed until MBZUAI confirms it.',
  '2026-10-23 09:00:00+04',
  '23 October 2026, 9:00 AM UAE time',
  'datetime',
  'Confirmed: listing status is registration open, dates are 11-12 November, and location is MBZUAI in Masdar City. Important distinction: the action says Register Your Interest, so form submission may not guarantee admission. Uncertain: registration deadline, cost, eligibility, capacity, and exact daily schedule. The reminder is Yusuf''s planning date, not an official deadline.'
),
(
  'Hub71 Initiate',
  'Hub71',
  'hub71 initiate',
  'hub71',
  '(^initiate$|hub71 initiate)',
  'program',
  'https://www.hub71.com/program/initiate',
  'The official programme page and application form are live. Initiate is for ideation or pre-seed founders and supports EdTech and startups using AI as a core enabler. No application closing date is stated.',
  null,
  null,
  null,
  null,
  null,
  null,
  'Decide whether to build from Abu Dhabi and accept possible venture-builder equity; if yes, prepare the truthful website, company email, pitch deck, metrics, founder details, and Abu Dhabi plan.',
  '2026-10-27 09:00:00+04',
  '27 October 2026, 9:00 AM UAE time',
  'datetime',
  'Possible SignBridge fit if it is still at idea or pre-MVP stage. Hub71 provides no direct Initiate funding and takes no equity. The selected venture builder sets its own funding terms; Hub71 says most typically take equity. Exact equity is unknown. Hub71 support lasts up to one year and includes venture-builder support, a free licence and office space for year one, soft landing, and ecosystem access. The form asks whether one co-founder will live in or relocate to Abu Dhabi. The reminder is Yusuf''s planning date, not an official deadline.'
),
(
  'Hub71+ AI',
  'Hub71',
  'hub71 ai',
  'hub71',
  '^hub71 ai$',
  'program',
  'https://www.hub71.com/program/hub71-plus-ai',
  'Cohort 21 applications are open. The official page states the deadline only as February 2027, review by April 2027, and a 12-month programme starting September 2027.',
  null,
  'February 2027; exact day not stated',
  null,
  null,
  null,
  null,
  'Wait for a SignBridge MVP and traction, then recheck the exact February deadline and decide whether SAFE equity and long-term Abu Dhabi relocation are acceptable.',
  '2027-01-15 09:00:00+04',
  '15 January 2027, 9:00 AM UAE time',
  'datetime',
  'For pre-seed to Series A AI startups. One founder is expected to relocate long-term and build a team in Abu Dhabi. Selected startups receive AED 250,000 in-kind support plus AED 250,000 cash for equity through a SAFE; this is not an application cost. A possible extra AED 250,000 requires additional equity. Exact SAFE valuation and equity percentage are not stated. The reminder is Yusuf''s planning date, not an official deadline.'
),
(
  'Hub71 Access Programme',
  'Hub71',
  'hub71 access programme',
  'hub71',
  '(hub71 )?access programme',
  'program',
  'https://www.hub71.com/program/access-programme',
  'Cohort 21 applications are open. The official page states the deadline only as February 2027, review by April 2027, and a 12-month programme starting September 2027.',
  null,
  'February 2027; exact day not stated',
  null,
  null,
  null,
  null,
  'Wait for a working SignBridge product and traction, then prepare the pitch, growth evidence, and long-term Abu Dhabi relocation plan.',
  '2027-01-15 09:05:00+04',
  '15 January 2027, 9:05 AM UAE time',
  'datetime',
  'For established pre-seed to Series A startups. One founder is expected to move to Abu Dhabi. The programme includes a three-month Techstars guided track within the 12-month programme. Selected startups receive AED 250,000 in-kind support plus AED 250,000 cash for equity through a SAFE; this is not an application cost. A possible extra AED 250,000 requires additional equity. Exact SAFE valuation and equity percentage are not stated. The reminder is Yusuf''s planning date, not an official deadline.'
),
(
  'DCAI Agentic AI for Government Services Accelerator',
  'Dubai Future Foundation / Dubai Centre for Artificial Intelligence',
  'dcai agentic ai for government services accelerator',
  'dubai future foundation dubai centre for artificial intelligence',
  '(dcai )?agentic ai for government services accelerator',
  'program',
  'https://www.dubaifuture.ae/dcai-accelerators/',
  'Applications are open now and cohorts run year-round. The accelerator seeks AI companies ready to build, test, and deploy agentic services with Dubai Government entities. Priority goes to Dubai AI Seal holders, but applications are open to all technology companies.',
  null,
  null,
  null,
  null,
  null,
  null,
  'Revisit only when SignBridge has a deployable agentic government-service use case and can demonstrate security, governance, data, integration, and delivery readiness.',
  null,
  null,
  null,
  'Future path, not a current application priority. Selection is based on capability, relevance, and readiness for trusted government deployment. Official pages do not state a fixed deadline, application fee, equity terms, travel support, or exact cohort commitment. Do not reuse terms from the closed 2023 programme.'
),
(
  'Hub71 Sandbox Programme',
  'Hub71 / Abu Dhabi Department of Economic Development',
  'hub71 sandbox programme',
  'hub71 abu dhabi department of economic development',
  '(hub71 )?sandbox programme',
  'program',
  'https://www.hub71.com/program/sandbox-programme',
  'The official Apply Now page is live. The programme is for market-ready companies that need controlled, regulator-supported testing before licensing or deployment in Abu Dhabi.',
  null,
  null,
  null,
  null,
  null,
  null,
  'Revisit only when SignBridge is market-ready and has a specific regulatory barrier that needs real-world testing with Abu Dhabi regulators.',
  null,
  null,
  null,
  'Future path, not a current application priority. Confirmed: Hub71 and ADDED connect companies with regulators, government entities, and testbeds. Uncertain: deadline, cost, duration, equity, detailed eligibility, and selection timing.'
);

-- Update retained records without changing any lifecycle status Yusuf already
-- confirmed. A retained item is made active again if it had been archived.
update public.opportunities as opportunity
set name = seed.name,
    organization = seed.organization,
    normalized_name = seed.normalized_name,
    normalized_organization = seed.normalized_organization,
    category = seed.category,
    source_url = seed.source_url,
    source_text = seed.source_text,
    deadline_at = seed.deadline_at,
    deadline_raw = seed.deadline_raw,
    deadline_precision = seed.deadline_precision,
    event_at = seed.event_at,
    event_raw = seed.event_raw,
    event_precision = seed.event_precision,
    next_action = seed.next_action,
    reminder_at = coalesce(opportunity.reminder_at, seed.reminder_at),
    reminder_raw = case when opportunity.reminder_at is null then seed.reminder_raw else opportunity.reminder_raw end,
    reminder_precision = case when opportunity.reminder_at is null then seed.reminder_precision else opportunity.reminder_precision end,
    notes = left(
      case
        when opportunity.notes is null or btrim(opportunity.notes) = '' then seed.notes
        else opportunity.notes || E'\n\nOfficial verification 2026-10-21: ' || seed.notes
      end,
      4000
    ),
    archived_at = null
from opportunity_master_seed as seed
where opportunity.source_url = seed.source_url
   or opportunity.normalized_name ~ seed.name_match;

insert into public.opportunities (
  draft_save_token,
  name,
  organization,
  normalized_name,
  normalized_organization,
  category,
  source_url,
  source_text,
  discovered_on,
  status,
  deadline_at,
  deadline_raw,
  deadline_precision,
  event_at,
  event_raw,
  event_precision,
  next_action,
  reminder_at,
  reminder_raw,
  reminder_precision,
  notes
)
select
  gen_random_uuid(),
  seed.name,
  seed.organization,
  seed.normalized_name,
  seed.normalized_organization,
  seed.category,
  seed.source_url,
  seed.source_text,
  '2026-10-21'::date,
  'saved',
  seed.deadline_at,
  seed.deadline_raw,
  seed.deadline_precision,
  seed.event_at,
  seed.event_raw,
  seed.event_precision,
  seed.next_action,
  seed.reminder_at,
  seed.reminder_raw,
  seed.reminder_precision,
  seed.notes
from opportunity_master_seed as seed
where not exists (
  select 1
  from public.opportunities as existing
  where existing.source_url = seed.source_url
     or existing.normalized_name ~ seed.name_match
);

-- Archive rather than delete previously saved rows, so Yusuf can recover one
-- if he changes his decision later.
update public.opportunities
set archived_at = coalesce(archived_at, now()),
    outcome = left(
      concat_ws(E'\n', nullif(outcome, ''), 'Removed from active tracking by Yusuf on 21 October 2026.'),
      2000
    )
where lower(name) ~ '(hub71.*digital assets|hub71.*life sciences|hpp global 2027|exploring (the )?human and planetary microbiome at scale|2026 human cell atlas middle east symposium|nabat terrapod.*challenge)'
   or lower(coalesce(source_url, '')) ~ '(hub71-plus-digital-assets|hub71-plus-life-sciences|nabat-terrapod)';

update public.opportunity_discovery_candidates
set status = 'dismissed',
    error_message = 'Removed from the master tracker by Yusuf on 2026-10-21.',
    updated_at = now()
where lower(name) ~ '(hub71.*digital assets|hub71.*life sciences|hpp global 2027|exploring (the )?human and planetary microbiome at scale|2026 human cell atlas middle east symposium|nabat terrapod.*challenge)'
   or lower(source_url) ~ '(hub71-plus-digital-assets|hub71-plus-life-sciences|nabat-terrapod)';
