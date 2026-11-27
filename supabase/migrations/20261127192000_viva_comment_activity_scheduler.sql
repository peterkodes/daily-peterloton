-- Drain Viva's individual N2 comment events through its managed server signer.
-- The scheduler secret stays encrypted in Vault, never appears in cron command.
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;
create or replace function public.kodes_viva_dispatch_comment_activity()
returns bigint language plpgsql security definer set search_path='' as $$
declare dispatch_secret text; request_id bigint;
begin
 if not exists(
  select 1 from public.kodes_partner_comment_outbox
   where delivered_at is null and attempts<12
 ) then return null;end if;
 select s.decrypted_secret into dispatch_secret
 from public.kodes_managed_server_connectors c
 join vault.decrypted_secrets s on s.id=c.cron_secret_id
 where c.public_site_id='7554902f-4506-494e-8f69-50e4cef8e767'::uuid
   and c.activated_at is not null and c.kodes_key_id is not null;
 if dispatch_secret is null then return null;end if;
 select net.http_post(
  url:='https://jyjrgdoeuzlvvpkymqsu.supabase.co/functions/v1/kodes-comment-activity-sync',
  body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json',
   'x-kodes-report-secret',dispatch_secret),
  timeout_milliseconds:=15000
 ) into request_id;
 return request_id;
end;$$;
revoke all on function public.kodes_viva_dispatch_comment_activity()
 from public,anon,authenticated;
select cron.schedule('kodes-viva-comment-activity-every-5m','*/5 * * * *',
 'select public.kodes_viva_dispatch_comment_activity()');
