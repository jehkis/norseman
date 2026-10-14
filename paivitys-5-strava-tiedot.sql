-- Päivitys 5: Stravan tarkat tiedot (kilometriajat, kierrokset, syke- ja vauhtikäyrä).
-- Aja tämä kerran Supabasen SQL Editorissa.
alter table public.entries add column if not exists details jsonb;
