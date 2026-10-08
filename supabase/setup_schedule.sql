-- Run once in Supabase SQL Editor after deployment.
-- The reminder worker runs every 15 minutes. Delivery records prevent repeats.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

do $$
declare
  v_project_url text := 'https://YOUR_PROJECT_REF.supabase.co';
  v_cron_secret text;
  v_secret_id uuid;
begin
  if v_project_url !~ '^https://[a-z0-9]{10,40}[.]supabase[.]co$' then
    raise exception 'Replace the project URL placeholder before running this file.';
  end if;

  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'opportunity_inbox_project_url'
  order by created_at desc
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_project_url,
      'opportunity_inbox_project_url',
      'Opportunity Inbox Edge Function base URL'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_project_url,
      'opportunity_inbox_project_url',
      'Opportunity Inbox Edge Function base URL'
    );
  end if;

  v_secret_id := null;
  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'opportunity_inbox_cron_secret'
  order by created_at desc
  limit 1;

  if v_secret_id is null then
    v_cron_secret := replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '');
    perform vault.create_secret(
      v_cron_secret,
      'opportunity_inbox_cron_secret',
      'Authenticates Opportunity Inbox reminder calls'
    );
  end if;
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'opportunity-inbox-reminders-15m'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'opportunity-inbox-reminders-15m',
    '*/15 * * * *',
    $command$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
          where name = 'opportunity_inbox_project_url'
          order by created_at desc limit 1)
          || '/functions/v1/opportunity-reminders',
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

-- Copy this into the OPPORTUNITY_CRON_SECRET Edge Function secret.
select decrypted_secret as "OPPORTUNITY_CRON_SECRET_copy_into_Edge_Function_secrets"
from vault.decrypted_secrets
where name = 'opportunity_inbox_cron_secret'
order by created_at desc
limit 1;
