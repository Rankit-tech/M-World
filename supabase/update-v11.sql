-- M. World update v11: security hardening (anti-spam, anti-flood, least privilege).
-- Run once in Supabase > SQL Editor, AFTER update-v10.sql. Safe to run again.
-- The admin (signed in) is never limited by these rules.

-- 1) Least privilege: visitors (anon) can never change or wipe data, whatever a policy says
revoke update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke all on table public.admins from anon, authenticated;

-- 2) Plays: need a real visitor id, and cap how many one visitor / the whole site can log
drop policy if exists "anyone can log a play" on public.plays;
create policy "anyone can log a play" on public.plays for insert
  with check (visitor is not null and char_length(visitor) between 8 and 64
              and kind in ('listen','complete'));

create or replace function public.plays_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return NEW; end if;
  if (select count(*) from public.plays p
      where p.visitor = NEW.visitor and p.created_at > now() - interval '1 hour') >= 120 then
    raise exception 'too many plays';
  end if;
  if (select count(*) from public.plays p where p.created_at > now() - interval '1 minute') >= 300 then
    raise exception 'busy, try again';
  end if;
  return NEW;
end $$;
drop trigger if exists plays_limit_trg on public.plays;
create trigger plays_limit_trg before insert on public.plays
  for each row execute function public.plays_limit();

-- 3) Visits: one per visitor every 30 seconds, and a site-wide ceiling
create or replace function public.visits_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return NEW; end if;
  NEW.created_at := now();
  if NEW.theme is not null and NEW.theme not in ('salon','bus','papa','raju','rap') then
    NEW.theme := null;
  end if;
  if exists (select 1 from public.visits v
             where v.visitor = NEW.visitor and v.created_at > now() - interval '30 seconds') then
    raise exception 'already counted';
  end if;
  if (select count(*) from public.visits v where v.created_at > now() - interval '1 minute') >= 300 then
    raise exception 'busy, try again';
  end if;
  return NEW;
end $$;
drop trigger if exists visits_limit_trg on public.visits;
create trigger visits_limit_trg before insert on public.visits
  for each row execute function public.visits_limit();

-- 4) Chat: strip hidden control characters, max 12 messages a minute per person,
--    and a site-wide ceiling so a bot with many fake IDs cannot flood the chat
create or replace function public.messages_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.created_at := now();
  NEW.text := btrim(regexp_replace(NEW.text, '[[:cntrl:]]', '', 'g'));
  if char_length(NEW.text) < 1 then raise exception 'empty message'; end if;
  if public.is_admin() then
    NEW.name := 'Admin';
    NEW.by_admin := true;
  else
    if NEW.secret is null or char_length(NEW.secret) < 16 or char_length(NEW.secret) > 128 then
      raise exception 'missing id';
    end if;
    NEW.name := 'MW-' || upper(substr(encode(sha256(convert_to(NEW.secret, 'UTF8')), 'hex'), 1, 6));
    NEW.by_admin := false;
  end if;
  NEW.secret := null;
  if not NEW.by_admin then
    if exists (select 1 from public.messages m
               where m.name = NEW.name and m.created_at > now() - interval '1 second') then
      raise exception 'slow down';
    end if;
    if (select count(*) from public.messages m
        where m.name = NEW.name and m.created_at > now() - interval '1 minute') >= 12 then
      raise exception 'slow down';
    end if;
    if (select count(*) from public.messages m
        where m.by_admin = false and m.created_at > now() - interval '1 minute') >= 40 then
      raise exception 'chat is busy, try again in a minute';
    end if;
  end if;
  return NEW;
end $$;

-- 5) Song requests: need a visitor id, max 5 a day each, 100 an hour site-wide
create or replace function public.requests_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return NEW; end if;
  NEW.created_at := now();
  NEW.status := 'new';
  NEW.title := btrim(regexp_replace(NEW.title, '[[:cntrl:]]', '', 'g'));
  NEW.artist := nullif(btrim(regexp_replace(coalesce(NEW.artist,''), '[[:cntrl:]]', '', 'g')), '');
  if char_length(NEW.title) < 1 then raise exception 'empty title'; end if;
  if NEW.visitor is null or char_length(NEW.visitor) not between 8 and 64 then
    raise exception 'missing id';
  end if;
  if (select count(*) from public.song_requests r
      where r.visitor = NEW.visitor and r.created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many requests today';
  end if;
  if (select count(*) from public.song_requests r where r.created_at > now() - interval '1 hour') >= 100 then
    raise exception 'busy, try again later';
  end if;
  return NEW;
end $$;
drop trigger if exists requests_limit_trg on public.song_requests;
create trigger requests_limit_trg before insert on public.song_requests
  for each row execute function public.requests_limit();

notify pgrst, 'reload schema';
