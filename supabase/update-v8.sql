-- M. World update v8: private song files with short-lived links.
-- Run once in Supabase > SQL Editor, AFTER update-v7.sql. Safe to run again.
--
-- After this, the song files are no longer reachable by a plain public link.
-- The website asks Supabase for a signed link that stops working after a few hours.
-- Songs of a private theme can no longer be fetched by anyone except the admin.
-- (A person who is really determined can still record what plays in their own browser;
--  no website can prevent that. This removes the easy ways: shared links and "save as".)

update storage.buckets set public = false where id = 'songs';

drop policy if exists "public can read song files" on storage.objects;
drop policy if exists "read song files that are listed" on storage.objects;
create policy "read song files that are listed" on storage.objects
  for select using (
    bucket_id = 'songs'
    and (
      public.is_admin()
      or exists (select 1 from public.songs s where s.file_path = storage.objects.name)
    )
  );

notify pgrst, 'reload schema';
