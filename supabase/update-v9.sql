-- M. World update v9: song requests from listeners.
-- Run once in Supabase > SQL Editor, AFTER update-v8.sql. Safe to run again.

create table if not exists public.song_requests (
  id         bigint generated always as identity primary key,
  title      text not null check (char_length(title) between 1 and 120),
  artist     text check (artist is null or char_length(artist) <= 80),
  theme      text check (theme is null or theme in ('salon','bus','papa','raju','rap')),
  visitor    text,
  status     text not null default 'new' check (status in ('new','done','rejected')),
  created_at timestamptz not null default now()
);
alter table public.song_requests enable row level security;

-- anyone can send a request; only the admin can read, update or delete them
drop policy if exists "anyone can request a song" on public.song_requests;
create policy "anyone can request a song" on public.song_requests
  for insert with check (status = 'new');
drop policy if exists "admin reads requests" on public.song_requests;
create policy "admin reads requests" on public.song_requests for select using (public.is_admin());
drop policy if exists "admin edits requests" on public.song_requests;
create policy "admin edits requests" on public.song_requests
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin deletes requests" on public.song_requests;
create policy "admin deletes requests" on public.song_requests for delete using (public.is_admin());

notify pgrst, 'reload schema';
