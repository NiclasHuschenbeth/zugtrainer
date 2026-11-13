-- Videolinks pro Kapitel: { "<Kapitelname>": "<Link in den Kundenbereich>" }, pro Kurs-Zeile in courses.
alter table public.courses add column if not exists videos jsonb not null default '{}'::jsonb;
