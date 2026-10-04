-- Norseman-treenipäiväkirja: aja tämä Supabasen SQL Editorissa kerran.

create table if not exists public.entries (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  sport       text not null check (sport in ('run','swim','bike','str','free')),
  dur         integer not null check (dur > 0 and dur <= 1440),
  dist        numeric,
  hr          integer,
  rpe         integer check (rpe between 1 and 10),
  title       text,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists entries_user_date on public.entries (user_id, date);

-- Rivitason suojaus: jokainen näkee ja muokkaa vain omia merkintöjään.
alter table public.entries enable row level security;

drop policy if exists "omat merkinnät: luku" on public.entries;
drop policy if exists "omat merkinnät: lisäys" on public.entries;
drop policy if exists "omat merkinnät: muokkaus" on public.entries;
drop policy if exists "omat merkinnät: poisto" on public.entries;

create policy "omat merkinnät: luku"     on public.entries for select to authenticated using (auth.uid() = user_id);
create policy "omat merkinnät: lisäys"   on public.entries for insert to authenticated with check (auth.uid() = user_id);
create policy "omat merkinnät: muokkaus" on public.entries for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "omat merkinnät: poisto"   on public.entries for delete to authenticated using (auth.uid() = user_id);

-- Reaaliaikainen synkronointi laitteiden välillä.
do $$ begin
  alter publication supabase_realtime add table public.entries;
exception when duplicate_object then null; end $$;
