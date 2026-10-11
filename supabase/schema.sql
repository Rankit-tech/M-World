-- M. World backend (Supabase). Run this whole file once in: Supabase dashboard > SQL Editor.

-- 1) Admins -----------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;  -- no policies: nobody can read it directly

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) Public live chat -------------------------------------------------------
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 20),
  text text not null check (char_length(text) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at desc);
alter table public.messages enable row level security;

drop policy if exists "anyone can read messages" on public.messages;
create policy "anyone can read messages" on public.messages
  for select using (true);

drop policy if exists "anyone can post messages" on public.messages;
create policy "anyone can post messages" on public.messages
  for insert with check (char_length(name) between 1 and 20 and char_length(text) between 1 and 200);

drop policy if exists "admin can delete messages" on public.messages;
create policy "admin can delete messages" on public.messages
  for delete using (public.is_admin());

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- 3) Song library -----------------------------------------------------------
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  theme text not null check (theme in ('salon','bus','papa','raju','rap')),
  file_path text not null,
  license text,
  credit text,
  created_at timestamptz not null default now()
);
alter table public.songs enable row level security;

drop policy if exists "anyone can read songs" on public.songs;
create policy "anyone can read songs" on public.songs
  for select using (true);

drop policy if exists "admin can add songs" on public.songs;
create policy "admin can add songs" on public.songs
  for insert with check (public.is_admin());

drop policy if exists "admin can edit songs" on public.songs;
create policy "admin can edit songs" on public.songs
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin can delete songs" on public.songs;
create policy "admin can delete songs" on public.songs
  for delete using (public.is_admin());

-- 4) Storage bucket for the audio files (public read, admin-only write) ------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('songs', 'songs', true, 15728640,
        array['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-wav'])
on conflict (id) do nothing;

drop policy if exists "public can read song files" on storage.objects;
create policy "public can read song files" on storage.objects
  for select using (bucket_id = 'songs');

drop policy if exists "admin can upload song files" on storage.objects;
create policy "admin can upload song files" on storage.objects
  for insert with check (bucket_id = 'songs' and public.is_admin());

drop policy if exists "admin can delete song files" on storage.objects;
create policy "admin can delete song files" on storage.objects
  for delete using (bucket_id = 'songs' and public.is_admin());
