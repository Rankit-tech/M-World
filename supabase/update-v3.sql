-- M. World update v3: admin can pin a song to a fixed position (#1, #2, ...).
-- Run once in Supabase > SQL Editor, AFTER update-v2.sql. Safe to run again.
-- Pinned songs always come first (in pin order). All other songs follow by listen score.

alter table public.songs add column if not exists pin_rank int;

drop function if exists public.ranked_songs(text);
create function public.ranked_songs(p_theme text default null)
returns table (
  id uuid, title text, artist text, theme text, file_path text, credit text,
  license text, created_at timestamptz, listens bigint, completes bigint,
  score bigint, rank int, pin_rank int
)
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select s.id, s.title, s.artist, s.theme, s.file_path, s.credit, s.license, s.created_at, s.pin_rank,
           count(p.id) filter (where p.kind = 'listen')   as listens,
           count(p.id) filter (where p.kind = 'complete') as completes
    from public.songs s
    left join public.plays p on p.song_id = s.id
    where p_theme is null or s.theme = p_theme
    group by s.id
  )
  select a.id, a.title, a.artist, a.theme, a.file_path, a.credit, a.license, a.created_at,
         a.listens, a.completes,
         (a.listens + 2 * a.completes) as score,
         (row_number() over (partition by a.theme
                             order by a.pin_rank asc nulls last,
                                      (a.listens + 2 * a.completes) desc, a.created_at asc))::int as rank,
         a.pin_rank
  from agg a
  order by a.theme, rank;
$$;
revoke all on function public.ranked_songs(text) from public;
grant execute on function public.ranked_songs(text) to anon, authenticated;

notify pgrst, 'reload schema';
