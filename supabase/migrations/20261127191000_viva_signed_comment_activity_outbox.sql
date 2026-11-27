-- Publisher outbox stores an immutable event snapshot so deletion of a
-- local comment cannot erase the pending revocation event.
create table if not exists public.kodes_partner_comment_outbox (
 event_id uuid primary key default gen_random_uuid(),
 comment_id uuid not null,
 reader_user_id uuid not null,
 article_slug text not null check(article_slug ~ '^[A-Za-z0-9_.:@-]{1,200}$'),
 is_reply boolean not null,
 event_status text not null check(event_status in ('pending','approved','rejected','hidden','removed')),
 source_created_at timestamptz not null,
 source_updated_at timestamptz not null default now(),
 attempts int not null default 0,
 last_error text,
 delivered_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists kodes_partner_comment_outbox_pending
 on public.kodes_partner_comment_outbox(created_at) where delivered_at is null;
alter table public.kodes_partner_comment_outbox enable row level security;
revoke all on public.kodes_partner_comment_outbox from public,anon,authenticated;
grant select,insert,update on public.kodes_partner_comment_outbox to service_role;

create or replace function public.kodes_viva_enqueue_signed_comment()
returns trigger language plpgsql security definer set search_path='' as $$
declare item public.comments%rowtype; article_slug text;
begin
 select * into item from public.comments where id=new.comment_id;
 if not found then return new;end if;
 select a.slug into article_slug from public.articles a where a.id=item.article_id;
 if article_slug is null then return new;end if;
 insert into public.kodes_partner_comment_outbox
 (comment_id,reader_user_id,article_slug,is_reply,event_status,source_created_at,source_updated_at)
 values(new.comment_id,item.user_id,article_slug,item.parent_id is not null,
  case when item.status='hidden' then 'hidden'
   when item.status='approved' then 'approved'
   when item.status='rejected' then 'rejected' else 'pending' end,item.created_at,now());
 return new;
end;$$;
revoke all on function public.kodes_viva_enqueue_signed_comment() from public,anon,authenticated;
drop trigger if exists kodes_viva_initial_activity on public.kodes_comment_signatures;
create trigger kodes_viva_initial_activity after insert on public.kodes_comment_signatures
 for each row execute function public.kodes_viva_enqueue_signed_comment();

create or replace function public.kodes_viva_enqueue_moderation_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare slug text;
begin
 if new.status is distinct from old.status and exists(
  select 1 from public.kodes_comment_signatures where comment_id=new.id) then
  select a.slug into slug from public.articles a where a.id=new.article_id;
  if slug is not null then
   insert into public.kodes_partner_comment_outbox
   (comment_id,reader_user_id,article_slug,is_reply,event_status,source_created_at,source_updated_at)
   values(new.id,new.user_id,slug,new.parent_id is not null,
    case when new.status='approved' then 'approved'
     when new.status='rejected' then 'rejected'
     when new.status='hidden' then 'hidden'
     else 'pending' end,new.created_at,now());
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.kodes_viva_enqueue_moderation_change() from public,anon,authenticated;
drop trigger if exists kodes_viva_activity_moderation on public.comments;
create trigger kodes_viva_activity_moderation after update of status on public.comments
 for each row execute function public.kodes_viva_enqueue_moderation_change();

create or replace function public.kodes_viva_enqueue_comment_delete()
returns trigger language plpgsql security definer set search_path='' as $$
declare slug text;
begin
 if exists(select 1 from public.kodes_comment_signatures where comment_id=old.id) then
  select a.slug into slug from public.articles a where a.id=old.article_id;
  if slug is not null then
   insert into public.kodes_partner_comment_outbox
   (comment_id,reader_user_id,article_slug,is_reply,event_status,source_created_at,source_updated_at)
   values(old.id,old.user_id,slug,old.parent_id is not null,'removed',old.created_at,now());
  end if;
 end if;
 return old;
end;$$;
revoke all on function public.kodes_viva_enqueue_comment_delete() from public,anon,authenticated;
drop trigger if exists kodes_viva_activity_delete on public.comments;
create trigger kodes_viva_activity_delete before delete on public.comments
 for each row execute function public.kodes_viva_enqueue_comment_delete();

-- One-time reconciliation only for legacy comments that already had proof N2.
insert into public.kodes_partner_comment_outbox
 (comment_id,reader_user_id,article_slug,is_reply,event_status,source_created_at,source_updated_at)
select c.id,c.user_id,a.slug,c.parent_id is not null,
 case when c.status='approved' then 'approved'
  when c.status='rejected' then 'rejected'
  when c.status='hidden' then 'hidden' else 'pending' end,
 c.created_at,now()
from public.comments c join public.kodes_comment_signatures k on k.comment_id=c.id
join public.articles a on a.id=c.article_id
where a.slug ~ '^[A-Za-z0-9_.:@-]{1,200}$' and not exists(
 select 1 from public.kodes_partner_comment_outbox e where e.comment_id=c.id);
