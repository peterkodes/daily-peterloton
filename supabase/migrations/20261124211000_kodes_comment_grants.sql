-- Viva Midia pilot: only the backend authorizes a user to comment.
-- Existing readers, articles and historical comments remain untouched.
create table if not exists public.kodes_comment_grants(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  level integer not null check(level between 1 and 5),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source text not null default 'dual_session_kodes'
     check(source='dual_session_kodes')
);
alter table public.kodes_comment_grants enable row level security;
revoke all on public.kodes_comment_grants from public,anon,authenticated;
grant select on public.kodes_comment_grants to authenticated;
drop policy if exists kodes_grants_read_own on public.kodes_comment_grants;
create policy kodes_grants_read_own on public.kodes_comment_grants for select
to authenticated using (user_id=(select auth.uid()));
-- No INSERT/UPDATE/DELETE grants for browser clients.
-- Service role verifies one-time Kodes ticket before upsert.
