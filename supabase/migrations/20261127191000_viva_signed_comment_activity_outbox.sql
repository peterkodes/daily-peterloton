-- Journal on publisher DB: no personal name, email or comment text leaves Viva.
-- Rows are created inside the SAME transaction as the signed Viva comment.
create table if not exists public.kodes_partner_comment_outbox (
 event_id uuid primary key default gen_random_uuid(),
 comment_id uuid not null references public.comments(id) on delete cascade,
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
declare item public.comments%rowtype;
begin
 select * into item from public.comments where id=new.comment_id;
 if not found then return new;end if;
 insert into public.kodes_partner_comment_outbox
 (comment_id,event_status,source_created_at,source_updated_at)
 values(new.comment_id,case when item.status='hidden' then 'hidden'
  when item.status='approved' then 'approved'
  when item.status='rejected' then 'rejected'
  else 'pending' end,item.created_at,now());
 return new;
end;$$;
revoke all on function public.kodes_viva_enqueue_signed_comment() from public,anon,authenticated;
drop trigger if exists kodes_viva_initial_activity on public.kodes_comment_signatures;
create trigger kodes_viva_initial_activity after insert on public.kodes_comment_signatures
 for each row execute function public.kodes_viva_enqueue_signed_comment();

create or replace function public.kodes_viva_enqueue_moderation_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and exists(
  select 1 from public.kodes_comment_signatures where comment_id=new.id) then
  insert into public.kodes_partner_comment_outbox
  (comment_id,event_status,source_created_at,source_updated_at)
  values(new.id,case when new.status='approved' then 'approved'
    when new.status='rejected' then 'rejected'
    when new.status='hidden' then 'hidden'
    else 'pending' end,new.created_at,now());
 end if;
 return new;
end;$$;
revoke all on function public.kodes_viva_enqueue_moderation_change() from public,anon,authenticated;
drop trigger if exists kodes_viva_activity_moderation on public.comments;
create trigger kodes_viva_activity_moderation after update of status on public.comments
 for each row execute function public.kodes_viva_enqueue_moderation_change();

-- One-time reconciliation of previously stamped N2 comments; do not stamp
-- old, non-N2 comments or infer a credential retroactively.
insert into public.kodes_partner_comment_outbox
 (comment_id,event_status,source_created_at,source_updated_at)
select c.id,
 case when c.status='approved' then 'approved'
  when c.status='rejected' then 'rejected'
  when c.status='hidden' then 'hidden' else 'pending' end,
 c.created_at,now()
from public.comments c join public.kodes_comment_signatures k on k.comment_id=c.id
where not exists(select 1 from public.kodes_partner_comment_outbox e where e.comment_id=c.id);
