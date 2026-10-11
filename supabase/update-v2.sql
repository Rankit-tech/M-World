-- M. World update v2: song ranking, fixed chat IDs, admin badge.
-- Run this once in Supabase > SQL Editor, AFTER schema.sql and analytics.sql. Safe to run again.

-- 1) Listens: count only people who actually stayed and listened -------------------
alter table public.plays add column if not exists kind text not null default 'listen';
alter table public.plays add column if not exists visitor text;
do $$
begin
  alter table public.plays add constraint plays_kind_check check (kind in ('listen','complete'));
exception when duplicate_object then null;
end $$;

create or replace function public.plays_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  NEW.created_at := now();
  if NEW.visitor is not null and exists (
    select 1 from public.plays p
    where p.song_id = NEW.song_id and p.visitor = NEW.visitor and p.kind = NEW.kind
      and p.created_at > now() - interval '30 minutes'
  ) then
    raise exception 'already counted';
  end if;
  return NEW;
end $$;
drop trigger if exists plays_guard_trg on public.plays;
create trigger plays_guard_trg before insert on public.plays
  for each row execute function public.plays_guard();
create index if not exists plays_song_idx on public.plays (song_id);

-- 2) Ranked songs for the player (public) -------------------------------------------
-- score = listens (stayed 20 seconds) + 2 x completes (listened to the end)
create or replace function public.ranked_songs(p_theme text default null)
returns table (
  id uuid, title text, artist text, theme text, file_path text, credit text,
  license text, created_at timestamptz, listens bigint, completes bigint,
  score bigint, rank int
)
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select s.id, s.title, s.artist, s.theme, s.file_path, s.credit, s.license, s.created_at,
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
                             order by (a.listens + 2 * a.completes) desc, a.created_at asc))::int as rank
  from agg a
  order by a.theme, rank;
$$;
revoke all on function public.ranked_songs(text) from public;
grant execute on function public.ranked_songs(text) to anon, authenticated;

-- 3) Chat: every user gets a fixed ID, nobody can pick or change a name --------------
alter table public.messages add column if not exists secret text;
alter table public.messages add column if not exists by_admin boolean not null default false;

create or replace function public.messages_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  NEW.created_at := now();
  if public.is_admin() then
    NEW.name := 'Admin';
    NEW.by_admin := true;
  else
    if NEW.secret is null or char_length(NEW.secret) < 16 then
      raise exception 'missing id';
    end if;
    NEW.name := 'MW-' || upper(substr(encode(sha256(convert_to(NEW.secret, 'UTF8')), 'hex'), 1, 6));
    NEW.by_admin := false;
  end if;
  NEW.secret := null;   -- the secret is never stored, so nobody can copy another user's ID
  if exists (select 1 from public.messages m
             where m.name = NEW.name and m.created_at > now() - interval '1 second') then
    raise exception 'slow down';
  end if;
  return NEW;
end $$;
drop trigger if exists messages_identity_trg on public.messages;
create trigger messages_identity_trg before insert on public.messages
  for each row execute function public.messages_identity();
create index if not exists messages_name_idx on public.messages (name, created_at desc);

-- 4) Dashboard numbers: top songs now use the new ranking ---------------------------
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
    'plays_today', (select count(*) from public.plays where kind = 'listen' and (created_at at time zone tz)::date = today),
    'plays_total', (select count(*) from public.plays where kind = 'listen'),
    'top_songs', (
      select coalesce(json_agg(x), '[]'::json) from (
        select s.title, s.theme,
               count(p.id) filter (where p.kind = 'listen') as plays,
               count(p.id) filter (where p.kind = 'complete') as completes
        from public.songs s left join public.plays p on p.song_id = s.id
        group by s.id
        order by (count(p.id) filter (where p.kind = 'listen')
                  + 2 * count(p.id) filter (where p.kind = 'complete')) desc, s.created_at asc
        limit 5) x)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_stats(int) from public;
grant execute on function public.admin_stats(int) to authenticated;

-- 5) Tell the API to pick up the new columns and functions right away
notify pgrst, 'reload schema';
