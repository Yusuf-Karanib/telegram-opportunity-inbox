-- Results found before the stricter verification rules were mostly articles,
-- duplicates, or expired events. Do not drip-send that old queue.
update public.opportunity_discovery_candidates
set
  status = 'dismissed',
  error_message = 'Cleared during the discovery quality reset.',
  updated_at = now()
where status in ('new', 'failed');
