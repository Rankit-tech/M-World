-- M. World update v4: admin can change the background photo of each theme.
-- Run once in Supabase > SQL Editor, AFTER update-v3.sql. Safe to run again.

create table if not exists public.wallpapers (
  theme      text primary key,
  file_path  text not null,
  updated_at timestamptz not null default now()
);
alter table public.wallpapers enable row level security;

drop policy if exists "anyone can read wallpapers" on public.wallpapers;
create policy "anyone can read wallpapers" on public.wallpapers for select using (true);
drop policy if exists "admin can add wallpapers" on public.wallpapers;
create policy "admin can add wallpapers" on public.wallpapers for insert with check (public.is_admin());
drop policy if exists "admin can edit wallpapers" on public.wallpapers;
create policy "admin can edit wallpapers" on public.wallpapers
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin can delete wallpapers" on public.wallpapers;
create policy "admin can delete wallpapers" on public.wallpapers for delete using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wallpapers', 'wallpapers', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "public can read wallpaper files" on storage.objects;
create policy "public can read wallpaper files" on storage.objects
  for select using (bucket_id = 'wallpapers');
drop policy if exists "admin can upload wallpaper files" on storage.objects;
create policy "admin can upload wallpaper files" on storage.objects
  for insert with check (bucket_id = 'wallpapers' and public.is_admin());
drop policy if exists "admin can delete wallpaper files" on storage.objects;
create policy "admin can delete wallpaper files" on storage.objects
  for delete using (bucket_id = 'wallpapers' and public.is_admin());

notify pgrst, 'reload schema';
