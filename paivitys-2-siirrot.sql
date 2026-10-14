-- Päivitys 2: treenien siirto toiselle päivälle.
-- Aja tämä kerran Supabasen SQL Editorissa.
create table if not exists public.moves (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_date   date not null,
  idx         integer not null,
  to_date     date not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, from_date, idx)
);

alter table public.moves enable row level security;

drop policy if exists "omat siirrot: luku" on public.moves;
drop policy if exists "omat siirrot: lisäys" on public.moves;
drop policy if exists "omat siirrot: muokkaus" on public.moves;
drop policy if exists "omat siirrot: poisto" on public.moves;

create policy "omat siirrot: luku"     on public.moves for select to authenticated using (auth.uid() = user_id);
create policy "omat siirrot: lisäys"   on public.moves for insert to authenticated with check (auth.uid() = user_id);
create policy "omat siirrot: muokkaus" on public.moves for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "omat siirrot: poisto"   on public.moves for delete to authenticated using (auth.uid() = user_id);

do $$ begin
  alter publication supabase_realtime add table public.moves;
exception when duplicate_object then null; end $$;
