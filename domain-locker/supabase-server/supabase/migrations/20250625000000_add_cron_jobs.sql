-- Replace cron jobs by name before scheduling them

-- 1. expiration-invites
SELECT cron.schedule(
  'expiration-invites', '0 6 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/expiration-invites',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_key'),
        'X-Cron-Run', 'true'
      ),
      body := jsonb_build_object('invoked_at', now())
    );
  $$
);

-- 2. run_website_monitor_job
SELECT cron.schedule(
  'run_website_monitor_job', '0 * * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/website-monitor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_key'),
        'X-Cron-Run', 'true'
      ),
      body := jsonb_build_object('invoked_at', now()),
      timeout_milliseconds := 10000
    );
  $$
);

-- 3. run_domain_update_job
SELECT cron.schedule(
  'run_domain_update_job', '0 4 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/trigger-updates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_key'),
        'X-Cron-Run', 'true'
      ),
      body := jsonb_build_object('invoked_at', now())
    );
  $$
);

-- 4. cleanup-notifications
SELECT cron.schedule(
  'cleanup-notifications', '0 5 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/cleanup-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_key'),
        'X-Cron-Run', 'true'
      ),
      body := jsonb_build_object('invoked_at', now())
    );
  $$
);

-- 5. new-user-billing
SELECT cron.schedule(
  'new-user-billing', '0 3 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/new-user-billing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_key'),
        'X-Cron-Run', 'true'
      ),
      body := jsonb_build_object('invoked_at', now())
    );
  $$
);

-- 6. expiration-reminders
SELECT cron.schedule(
  'expiration-reminders', '0 7 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/expiration-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_key'),
        'X-Cron-Run', 'true'
      ),
      body := jsonb_build_object('invoked_at', now())
    );
  $$
);

-- 7. cleanup-monitor-data
SELECT cron.schedule(
  'cleanup-monitor-data', '0 2 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/cleanup-monitor-data',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_key'),
        'X-Cron-Run', 'true'
      ),
      body := jsonb_build_object('invoked_at', now())
    );
  $$
);
