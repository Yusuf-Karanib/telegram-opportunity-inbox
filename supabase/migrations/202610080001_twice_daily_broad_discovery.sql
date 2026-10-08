-- Add structured decision details and run the opportunity scout at
-- 07:00 and 19:00 Asia/Dubai (03:00 and 15:00 UTC).

alter table public.opportunity_discovery_candidates
  add column if not exists decision_details jsonb;

alter table public.opportunity_discovery_candidates
  drop constraint if exists opportunity_discovery_decision_details_object;

alter table public.opportunity_discovery_candidates
  add constraint opportunity_discovery_decision_details_object
  check (decision_details is null or jsonb_typeof(decision_details) = 'object');

create index if not exists opportunity_discovery_fit_score_idx
  on public.opportunity_discovery_candidates
  (((decision_details ->> 'fit_score')::integer) desc)
  where decision_details ? 'fit_score';

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname in (
      'opportunity-inbox-daily-discovery',
      'opportunity-inbox-twice-daily-discovery'
    )
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'opportunity-inbox-twice-daily-discovery',
    '0 3,15 * * *',
    $command$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
          where name = 'opportunity_inbox_project_url'
          order by created_at desc limit 1)
          || '/functions/v1/opportunity-discovery',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
            where name = 'opportunity_inbox_cron_secret'
            order by created_at desc limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $command$
  );
end;
$$;
