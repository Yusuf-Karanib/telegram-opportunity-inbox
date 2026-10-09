-- Scheduled runs send a one-line confirmation when there is nothing new.
-- Manual /discover calls keep their own response and do not set this flag.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'opportunity-inbox-twice-daily-discovery'
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
        body := '{"notify_empty": true}'::jsonb,
        timeout_milliseconds := 120000
      );
    $command$
  );
end;
$$;
