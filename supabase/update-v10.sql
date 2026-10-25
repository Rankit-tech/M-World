-- M. World update v10: optional background video for a song.
-- Run once in Supabase > SQL Editor, AFTER update-v9.sql. Safe to run again.

alter table public.songs add column if not exists video_path text;

-- the songs bucket now also accepts short videos (up to 50 MB each)
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-wav',
                               'video/mp4','video/webm']
where id = 'songs';

-- visitors may fetch a file only if a visible song uses it (as its audio or its video)
drop policy if exists "read song files that are listed" on storage.objects;
create policy "read song files that are listed" on storage.objects
  for select using (
    bucket_id = 'songs'
    and (
      public.is_admin()
      or exists (select 1 from public.songs s
                 where s.file_path = storage.objects.name or s.video_path = storage.objects.name)
    )
  );

drop function if exists public.ranked_songs(text);
create function public.ranked_songs(p_theme text default null)
returns table (
  id uuid, title text, artist text, theme text, file_path text, credit text,
  license text, created_at timestamptz, listens bigint, completes bigint,
  score bigint, rank int, pin_rank int, wallpaper_path text, trend_rank int, video_path text
)
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select s.id, s.title, s.artist, s.theme, s.file_path, s.credit, s.license, s.created_at,
           s.pin_rank, s.wallpaper_path, s.trend_rank, s.video_path,
           count(p.id) filter (where p.kind = 'listen')   as listens,
           count(p.id) filter (where p.kind = 'complete') as completes
    from public.songs s
    left join public.plays p on p.song_id = s.id
    where (p_theme is null or s.theme = p_theme)
      and (public.is_admin()
           or coalesce((select t.is_public from public.theme_settings t where t.theme = s.theme), true))
    group by s.id
  )
  select a.id, a.title, a.artist, a.theme, a.file_path, a.credit, a.license, a.created_at,
         a.listens, a.completes,
         (a.listens + 2 * a.completes) as score,
         (row_number() over (partition by a.theme
                             order by a.pin_rank asc nulls last,
                                      a.trend_rank asc nulls last,
                                      (a.listens + 2 * a.completes) desc, a.created_at asc))::int as rank,
         a.pin_rank, a.wallpaper_path, a.trend_rank, a.video_path
  from agg a
  order by a.theme, rank;
$$;
revoke all on function public.ranked_songs(text) from public;
grant execute on function public.ranked_songs(text) to anon, authenticated;

notify pgrst, 'reload schema';
