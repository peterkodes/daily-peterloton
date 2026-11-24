-- Activate only AFTER the Kodes-ID reader journey and Viva Edge gateway have been
-- published and smoke-tested together. Enforces N2 on EVERY new comment/reply
-- even through direct REST calls. No update to historical comments.
drop policy if exists comments_require_kodes_id_n2 on public.comments;
create policy comments_require_kodes_id_n2 on public.comments
as restrictive for insert to authenticated
with check (
  exists(
    select 1 from public.kodes_comment_grants g
    where g.user_id=(select auth.uid())
      and g.level>=2
      and g.expires_at>now()
  )
);
comment on table public.kodes_comment_grants is
 'Temporary N2 participation grants from Kodes-ID, validated server-to-server. Historical comments are unchanged.';
