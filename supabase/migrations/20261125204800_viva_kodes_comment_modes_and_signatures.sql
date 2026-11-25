-- Kodes Connect / Viva: manual or automatic comment publication.
-- Applied to Viva database on 2026-11-25. Re-runnable after restore.
-- N2 is enforced independently by restrictive policy comments_require_kodes_id_n2.
create table if not exists public.kodes_comment_moderation_settings (
 id boolean primary key default true check(id),
 approval_mode text not null default 'manual'
  check(approval_mode in ('manual','automatic')),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
alter table public.kodes_comment_moderation_settings enable row level security;
insert into public.kodes_comment_moderation_settings(id,approval_mode)
 values(true,'manual') on conflict(id) do nothing;
revoke all on public.kodes_comment_moderation_settings from public,anon,authenticated;
grant select on public.kodes_comment_moderation_settings to anon,authenticated;
grant update(approval_mode) on public.kodes_comment_moderation_settings to authenticated;
drop policy if exists moderation_settings_public_read on public.kodes_comment_moderation_settings;
create policy moderation_settings_public_read on public.kodes_comment_moderation_settings
 for select to anon,authenticated using(true);
drop policy if exists moderation_settings_admin_update on public.kodes_comment_moderation_settings;
create policy moderation_settings_admin_update on public.kodes_comment_moderation_settings
 for update to authenticated
 using(exists(select 1 from public.user_roles
   where user_id=(select auth.uid()) and role='admin'))
 with check(exists(select 1 from public.user_roles
   where user_id=(select auth.uid()) and role='admin'));

create or replace function public.kodes_viva_autopublish_comment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status <> 'pending' then return new; end if;
 if exists(select 1 from public.kodes_comment_moderation_settings s
           where s.id=true and s.approval_mode='automatic') then
   update public.comments set status='approved'
    where id=new.id and status='pending';
 end if;
 return new;
end; $$;
revoke all on function public.kodes_viva_autopublish_comment()
 from public,anon,authenticated;
drop trigger if exists kodes_viva_auto_publish on public.comments;
create trigger kodes_viva_auto_publish after insert on public.comments
 for each row execute function public.kodes_viva_autopublish_comment();

-- Immutable proof captured while a valid, independently issued N2 grant exists.
-- Do not backfill historical comments; an old grant is not evidence of publication identity.
create table if not exists public.kodes_comment_signatures(
 comment_id uuid primary key references public.comments(id) on delete cascade,
 level smallint not null check(level between 2 and 5),
 verified_at timestamptz not null,
 origin text not null default 'dual_session_kodes'
  check(origin='dual_session_kodes')
);
alter table public.kodes_comment_signatures enable row level security;
revoke all on public.kodes_comment_signatures from public,anon,authenticated;
grant select on public.kodes_comment_signatures to anon,authenticated;
drop policy if exists read_published_kodes_signatures on public.kodes_comment_signatures;
create policy read_published_kodes_signatures on public.kodes_comment_signatures
 for select to anon,authenticated
 using(exists(select 1 from public.comments c where c.id=comment_id
  and(c.status='approved' or c.user_id=(select auth.uid()))));

create or replace function public.kodes_viva_stamp_comment_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare verified_level integer;
begin
 select g.level into verified_level from public.kodes_comment_grants g
  where g.user_id=new.user_id and g.level>=2
    and g.expires_at>new.created_at and g.source='dual_session_kodes';
 if verified_level is not null then
  insert into public.kodes_comment_signatures(comment_id,level,verified_at,origin)
   values(new.id,least(verified_level,5),new.created_at,'dual_session_kodes')
   on conflict(comment_id) do nothing;
 end if;
 return new;
end; $$;
revoke all on function public.kodes_viva_stamp_comment_identity()
 from public,anon,authenticated;
drop trigger if exists kodes_viva_comment_identity_stamp on public.comments;
create trigger kodes_viva_comment_identity_stamp after insert on public.comments
 for each row execute function public.kodes_viva_stamp_comment_identity();
