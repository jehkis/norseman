-- Päivitys: voimaharjoitusten painot sarjoittain.
-- Aja tämä kerran Supabasen SQL Editorissa, jos loit tietokannan ennen tätä päivitystä.
alter table public.entries add column if not exists sets jsonb;
