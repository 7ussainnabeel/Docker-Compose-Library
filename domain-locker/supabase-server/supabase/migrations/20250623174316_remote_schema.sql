drop trigger if exists "send_unsent_notifications" on "public"."notifications";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user_billing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  request_url TEXT := 'https://domain-locker.supabase.co/functions/v1/new-user-billing';
  payload JSONB;
BEGIN
  payload := jsonb_build_object('userId', NEW.id);

  -- Fire and forget; do not block user creation
  PERFORM
    net.http_post(
      url := request_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := payload,
      timeout_milliseconds := 5000
    );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error, but do not interrupt signup
  RAISE NOTICE 'Failed to call billing function: %', SQLERRM;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pg_version()
 RETURNS text
 LANGUAGE sql
AS $function$
  select version();
$function$
;

CREATE OR REPLACE FUNCTION public.send_notification_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  payload jsonb;
  project_url text;
  svc_jwt text;
BEGIN
  -- Build payload
  payload := jsonb_build_object(
    'userId', NEW.user_id,
    'message', NEW.message
  );

  -- Load auth secrets
  SELECT decrypted_secret INTO project_url
    FROM vault.decrypted_secrets
   WHERE name = 'project_url';

  SELECT decrypted_secret INTO svc_jwt
    FROM vault.decrypted_secrets
   WHERE name = 'service_key';

  BEGIN
    PERFORM net.http_post(
      url := project_url || '/functions/v1/send-notification',
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'Authorization',    'Bearer ' || svc_jwt
      ),
      body := payload::jsonb,
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log any HTTP errors but don't interrupt insertion
    RAISE WARNING 'Failed to notify edge function: %', SQLERRM;
  END;

  -- Mark notification as sent
  UPDATE public.notifications
     SET sent = TRUE
   WHERE id = NEW.id;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_setup_user_billing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    request_body TEXT;
    request_response JSONB;
BEGIN
    request_body := json_build_object('userId', NEW.id)::text;
    IF NEW.confirmation_sent_at IS NOT NULL OR NEW.last_sign_in_at IS NOT NULL THEN
        SELECT net.http_post(
            url := 'https://domain-locker.supabase.co/functions/v1/new-user-billing',
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := request_body::jsonb,
            timeout_milliseconds := 1500
        ) INTO request_response;
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.uptime_daily_averages(target_domain uuid, cutoff_time timestamp with time zone)
 RETURNS TABLE(day date, avg_is_up double precision, avg_response_time_ms double precision, avg_dns_time_ms double precision, avg_ssl_time_ms double precision)
 LANGUAGE sql
AS $function$
  select
    date_trunc('day', checked_at)::date as day,
    avg(case when is_up then 1 else 0 end) as avg_is_up,
    avg(response_time_ms) as avg_response_time_ms,
    avg(dns_lookup_time_ms) as avg_dns_time_ms,
    avg(ssl_handshake_time_ms) as avg_ssl_time_ms
  from uptime
  where domain_id = target_domain and checked_at < cutoff_time
  group by 1
  order by 1
$function$
;

CREATE OR REPLACE FUNCTION public.delete_domain(domain_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$BEGIN
  -- Delete related records
  DELETE FROM notifications WHERE notifications.domain_id = $1;
  DELETE FROM ip_addresses WHERE ip_addresses.domain_id = $1;
  DELETE FROM domain_tags WHERE domain_tags.domain_id = $1;
  DELETE FROM notification_preferences WHERE notification_preferences.domain_id = $1;
  DELETE FROM dns_records WHERE dns_records.domain_id = $1;
  DELETE FROM ssl_certificates WHERE ssl_certificates.domain_id = $1;
  DELETE FROM whois_info WHERE whois_info.domain_id = $1;
  DELETE FROM domain_hosts WHERE domain_hosts.domain_id = $1;
  DELETE FROM domain_costings WHERE domain_costings.domain_id = $1;
  DELETE FROM sub_domains WHERE sub_domains.domain_id = $1;

  -- Delete the domain itself
  DELETE FROM domains WHERE domains.id = $1;
  
  -- Clean up orphaned records
  DELETE FROM tags WHERE tags.id NOT IN (SELECT DISTINCT tag_id FROM domain_tags);
  DELETE FROM hosts WHERE hosts.id NOT IN (SELECT DISTINCT host_id FROM domain_hosts);
  DELETE FROM registrars WHERE registrars.id NOT IN (SELECT DISTINCT registrar_id FROM domains);

  RETURN;
END;$function$
;

CREATE OR REPLACE FUNCTION public.get_domain_uptime(user_id uuid, domain_id uuid, timeframe text)
 RETURNS TABLE(checked_at timestamp with time zone, is_up boolean, response_code integer, response_time_ms numeric, dns_lookup_time_ms numeric, ssl_handshake_time_ms numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  time_interval text;
begin
  -- Map the timeframe to an interval
  if timeframe = 'day' then
    time_interval := '1 day';
  elsif timeframe = 'week' then
    time_interval := '1 week';
  elsif timeframe = 'month' then
    time_interval := '1 month';
  elsif timeframe = 'year' then
    time_interval := '1 year';
  else
    time_interval := '1 day';
  end if;

  -- Fetch data filtered by user ownership, domain ID, and interval
  return query
    select
      u.checked_at,
      u.is_up,
      u.response_code,
      u.response_time_ms,
      u.dns_lookup_time_ms,
      u.ssl_handshake_time_ms
    from
      uptime u
    join
      domains d on u.domain_id = d.id
    where
      d.user_id = $1 -- Explicitly refer to the function parameter
      and u.domain_id = $2
      and u.checked_at >= now() - cast(time_interval as interval)
    order by
      u.checked_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_domains_by_epp_status_codes(status_codes text[])
 RETURNS TABLE(status_code text, domain_id uuid, domain_name text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    domain_statuses.status_code,
    domain_statuses.domain_id,
    domains.domain_name  -- Assuming the domain name is stored in the domains table
  FROM 
    domain_statuses
  JOIN 
    domains ON domain_statuses.domain_id = domains.id
  WHERE 
    domain_statuses.status_code = ANY(status_codes)
  ORDER BY 
    domain_statuses.status_code;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_ip_addresses_with_domains(p_is_ipv6 boolean)
 RETURNS TABLE(ip_address inet, domains text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ip.ip_address::inet,
    array_agg(DISTINCT d.domain_name) AS domains
  FROM 
    ip_addresses ip
    JOIN domains d ON ip.domain_id = d.id
  WHERE
    d.user_id = auth.uid()
    AND ip.is_ipv6 = p_is_ipv6
  GROUP BY 
    ip.ip_address
  ORDER BY 
    ip.ip_address;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_ssl_issuers_with_domain_counts()
 RETURNS TABLE(issuer text, domain_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    sc.issuer,
    COUNT(DISTINCT d.id) AS domain_count
  FROM 
    ssl_certificates sc
    JOIN domains d ON sc.domain_id = d.id
  WHERE
    d.user_id = auth.uid()
  GROUP BY 
    sc.issuer
  ORDER BY 
    domain_count DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_statuses_with_domain_counts()
 RETURNS TABLE(status_code text, domain_count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    domain_statuses.status_code,
    COUNT(domain_statuses.domain_id) AS domain_count
  FROM 
    domain_statuses
  GROUP BY 
    domain_statuses.status_code
  ORDER BY 
    domain_count DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_user_id_on_hosts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_user_id_on_registrars()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_send_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    notification_json jsonb;
    request_url text := 'https://domain-locker.supabase.co/functions/v1/send-notification';
begin
    -- Ensure schema is explicitly referenced
    set search_path to public;

    -- Build the JSON payload
    notification_json := jsonb_build_object(
        'message', NEW.message,
        'userId', NEW.user_id
    );

    -- Call the Supabase function to send the notification
    perform http_post(request_url, notification_json);

    -- Mark notification as sent
    update public.notifications
    set sent = true
    where id = NEW.id;

    return NEW;
end;
$function$
;

CREATE TRIGGER trigger_send_notification AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION send_notification_trigger();


