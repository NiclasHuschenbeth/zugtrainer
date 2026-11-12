-- Tabellen für Konten und Abgleich des Zugtrainers (Supabase).
-- Jede Zeile gehört einem Nutzer; Row Level Security erlaubt nur den Zugriff auf die eigenen Zeilen.

create table if not exists public.repertoires (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid not null,
  data       jsonb,
  updated_at bigint not null,
  deleted    boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.cards (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rep_id  uuid not null,
  key     text not null,
  level   integer not null,
  due     bigint not null,
  lapses  integer not null default 0,
  at      bigint not null,
  primary key (user_id, rep_id, key)
);
create index if not exists cards_user_at on public.cards (user_id, at);

create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  activity   jsonb not null default '{}'::jsonb,
  settings   jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0
);

alter table public.repertoires enable row level security;
alter table public.cards       enable row level security;
alter table public.profiles    enable row level security;

drop policy if exists own_rows on public.repertoires;
drop policy if exists own_rows on public.cards;
drop policy if exists own_rows on public.profiles;

create policy own_rows on public.repertoires for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.cards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Nur angemeldete Nutzer, nie anonyme Besucher
revoke all on public.repertoires, public.cards, public.profiles from anon;
grant select, insert, update, delete on public.repertoires, public.cards, public.profiles to authenticated;
