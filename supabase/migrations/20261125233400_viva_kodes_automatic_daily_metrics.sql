-- Self-service metric delivery. Supabase Cron + pg_net perform the daily
-- delivery automatically after the administrator approves the connector.
-- No cron secret or service_role key is embedded in the job command.
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.kodes_viva_dispatch_daily_telemetry()
returns bigint language plpgsql security definer set search_path='' as $$
declare report_secret text;
        result_id bigint;
begin
 select s.decrypted_secret into report_secret
 from public.kodes_managed_server_connectors c
 join vault.decrypted_secrets s on s.id=c.cron_secret_id
 where c.public_site_id='7554902f-4506-494e-8f69-50e4cef8e767'::uuid
   and c.activated_at is not null and c.kodes_key_id is not null;
 if report_secret is null then return null;end if;
 select net.http_post(
  url:='https://jyjrgdoeuzlvvpkymqsu.supabase.co/functions/v1/kodes-signed-telemetry',
  body:=jsonb_build_object('date',(now() at time zone 'UTC' - interval '1 day')::date::text),
  headers:=jsonb_build_object('Content-Type','application/json',
    'x-kodes-report-secret',report_secret),
  timeout_milliseconds:=12000
 ) into result_id;
 return result_id;
end;$$;
revoke all on function public.kodes_viva_dispatch_daily_telemetry()
 from public,anon,authenticated;
-- Supabase Cron runs the stored command with the DB scheduler privileges.
-- Naming the job makes this creation idempotent after restoring the database.
select cron.schedule('kodes-viva-managed-metrics-daily','15 3 * * *',
 'select public.kodes_viva_dispatch_daily_telemetry()');
