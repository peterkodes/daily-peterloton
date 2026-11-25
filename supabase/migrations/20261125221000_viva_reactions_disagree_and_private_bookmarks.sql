-- Viva Mídia reactions and bookmarks (applied on 2026-11-25).
-- Historical "like" remains the Vértice Relevant reaction.
alter table public.reactions drop constraint if exists reactions_reaction_type_check;
alter table public.reactions add constraint reactions_reaction_type_check
 check(reaction_type in ('like','disagree'));
drop policy if exists reactions_update on public.reactions;
create policy reactions_update on public.reactions
 for update to authenticated
 using (user_id=(select auth.uid()))
 with check (user_id=(select auth.uid()) and exists(
  select 1 from public.articles a where a.id=article_id
    and a.status='published' and a.published_at<=now()));
grant update(reaction_type) on public.reactions to authenticated;
create table if not exists public.kodes_saved_articles(
 user_id uuid not null references public.profiles(id) on delete cascade,
 article_id uuid not null references public.articles(id) on delete cascade,
 saved_at timestamptz not null default now(),
 primary key(user_id,article_id)
);
alter table public.kodes_saved_articles enable row level security;
revoke all on public.kodes_saved_articles from anon,authenticated;
grant select,insert,delete on public.kodes_saved_articles to authenticated;
drop policy if exists kodes_saved_select on public.kodes_saved_articles;
create policy kodes_saved_select on public.kodes_saved_articles
 for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists kodes_saved_insert on public.kodes_saved_articles;
create policy kodes_saved_insert on public.kodes_saved_articles
 for insert to authenticated with check(user_id=(select auth.uid())
 and exists(select 1 from public.articles a where a.id=article_id
 and a.status='published' and a.published_at<=now()));
drop policy if exists kodes_saved_delete on public.kodes_saved_articles;
create policy kodes_saved_delete on public.kodes_saved_articles
 for delete to authenticated using(user_id=(select auth.uid()));
