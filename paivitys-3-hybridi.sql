-- Päivitys 3: hybridi-tila, treenin vaihto ja uudet lajit.
-- Aja tämä kerran Supabasen SQL Editorissa.

-- Treenin vaihto kirjaston treeniin tallentuu siirtojen rinnalle.
alter table public.moves add column if not exists alt text;

-- Uudet lajit: toiminnallinen ja soutu/SkiErg.
alter table public.entries drop constraint if exists entries_sport_check;
alter table public.entries add constraint entries_sport_check
  check (sport in ('run','swim','bike','str','free','func','erg'));

-- Asetukset: tila (Norseman/Hybridi), viikkotavoitteet ja omat treenit.
create table if not exists public.settings (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.settings enable row level security;

drop policy if exists "omat asetukset: luku" on public.settings;
drop policy if exists "omat asetukset: lisäys" on public.settings;
drop policy if exists "omat asetukset: muokkaus" on public.settings;

create policy "omat asetukset: luku"     on public.settings for select to authenticated using (auth.uid() = user_id);
create policy "omat asetukset: lisäys"   on public.settings for insert to authenticated with check (auth.uid() = user_id);
create policy "omat asetukset: muokkaus" on public.settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;
