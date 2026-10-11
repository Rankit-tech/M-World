-- M. World analytics. Run this once in Supabase > SQL Editor (after schema.sql).

create table if not exists public.visits (
  id bigint generated always as identity primary key,
  visitor text not null check (char_length(visitor) between 8 and 64),
  theme text,
  created_at timestamptz not null default now()
);
create index if not exists visits_created_idx on public.visits (created_at desc);
alter table public.visits enable row level security;
drop policy if exists "anyone can log a visit" on public.visits;
create policy "anyone can log a visit" on public.visits for insert
  with check (char_length(visitor) between 8 and 64);
drop policy if exists "admin can read visits" on public.visits;
create policy "admin can read visits" on public.visits for select using (public.is_admin());

create table if not exists public.plays (
  id bigint generated always as identity primary key,
  song_id uuid not null references public.songs(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists plays_created_idx on public.plays (created_at desc);
alter table public.plays enable row level security;
drop policy if exists "anyone can log a play" on public.plays;
create policy "anyone can log a play" on public.plays for insert with check (true);
drop policy if exists "admin can read plays" on public.plays;
create policy "admin can read plays" on public.plays for select using (public.is_admin());

-- One call that returns everything the admin dashboard needs (admin only).
create or replace function public.admin_stats(p_days int default 14)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  tz constant text := 'Asia/Kolkata';
  today date := (now() at time zone tz)::date;
  d int := greatest(1, least(coalesce(p_days, 14), 90));
  res json;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select json_build_object(
    'daily', (
      select coalesce(json_agg(r order by r.day), '[]'::json) from (
        select g.day::text as day,
               coalesce(count(v.id), 0) as visits,
               coalesce(count(distinct v.visitor), 0) as visitors
        from generate_series(today - (d - 1), today, interval '1 day') as g(day)
        left join public.visits v on (v.created_at at time zone tz)::date = g.day::date
        group by g.day
      ) r),
    'today_visits', (select count(*) from public.visits where (created_at at time zone tz)::date = today),
    'today_visitors', (select count(distinct visitor) from public.visits where (created_at at time zone tz)::date = today),
    'total_visits', (select count(*) from public.visits),
    'total_visitors', (select count(distinct visitor) from public.visits),
    'songs_total', (select count(*) from public.songs),
    'songs_by_theme', (select coalesce(json_object_agg(theme, c), '{}'::json) from (select theme, count(*) c from public.songs group by theme) t),
    'messages_today', (select count(*) from public.messages where (created_at at time zone tz)::date = today),
    'messages_total', (select count(*) from public.messages),
    'plays_today', (select count(*) from public.plays where (created_at at time zone tz)::date = today),
    'plays_total', (select count(*) from public.plays),
    'top_songs', (
      select coalesce(json_agg(x), '[]'::json) from (
        select s.title, s.theme, count(p.id) as plays
        from public.songs s left join public.plays p on p.song_id = s.id
        group by s.id order by count(p.id) desc, s.created_at desc limit 5) x)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_stats(int) from public;
grant execute on function public.admin_stats(int) to authenticated;
