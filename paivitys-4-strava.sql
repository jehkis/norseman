-- Päivitys 4: Strava-yhteys.
-- Aja tämä kerran Supabasen SQL Editorissa.
-- Tokenit näkee ja muokkaa vain palvelinfunktio (service role), ei selain: taululla ei ole käytäntöjä.
create table if not exists public.strava_tokens (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  athlete_id     bigint,
  access_token   text,
  refresh_token  text,
  expires_at     bigint,
  last_sync      bigint,
  state          text,
  updated_at     timestamptz not null default now()
);

alter table public.strava_tokens enable row level security;
