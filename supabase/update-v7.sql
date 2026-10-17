-- M. World update v7: make a whole theme (like Rap Session) private or public.
-- Run once in Supabase > SQL Editor, AFTER update-v6.sql. Safe to run again.
-- Private theme = visitors do not see the station and its songs. You (signed in as admin) still see it.

create table if not exists public.theme_settings (
  theme      text primary key,
  is_public  boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.theme_settings enable row level security;

drop policy if exists "anyone can read theme settings" on public.theme_settings;
create policy "anyone can read theme settings" on public.theme_settings for select using (true);
drop policy if exists "admin can add theme settings" on public.theme_settings;
create policy "admin can add theme settings" on public.theme_settings for insert with check (public.is_admin());
drop policy if exists "admin can edit theme settings" on public.theme_settings;
create policy "admin can edit theme settings" on public.theme_settings
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin can delete theme settings" on public.theme_settings;
create policy "admin can delete theme settings" on public.theme_settings for delete using (public.is_admin());

-- songs of a private theme can only be read by the admin
drop policy if exists "anyone can read songs" on public.songs;
create policy "anyone can read songs" on public.songs
  for select using (
    public.is_admin()
    or coalesce((select t.is_public from public.theme_settings t where t.theme = songs.theme), true)
  );

drop function if exists public.ranked_songs(text);
create function public.ranked_songs(p_theme text default null)
returns table (
  id uuid, title text, artist text, theme text, file_path text, credit text,
  license text, created_at timestamptz, listens bigint, completes bigint,
  score bigint, rank int, pin_rank int, wallpaper_path text, trend_rank int
)
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select s.id, s.title, s.artist, s.theme, s.file_path, s.credit, s.license, s.created_at,
           s.pin_rank, s.wallpaper_path, s.trend_rank,
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
         a.pin_rank, a.wallpaper_path, a.trend_rank
  from agg a
  order by a.theme, rank;
$$;
revoke all on function public.ranked_songs(text) from public;
grant execute on function public.ranked_songs(text) to anon, authenticated;

notify pgrst, 'reload schema';
