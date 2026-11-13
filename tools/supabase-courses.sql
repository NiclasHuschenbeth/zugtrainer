-- Kurse und Freischaltungen (Supabase).
-- courses:       die Kurs-PGN samt Lösungstexten, einmal vom Anbieter hinterlegt.
-- entitlements:  wer welchen Kurs gekauft hat (E-Mail + Ablefy-Produktnummer), gepflegt vom Webhook.
-- webhook_log:   Protokoll der Meldungen von Ablefy (nur für den Anbieter, nie für Nutzer).
-- Nutzer sehen nur ihre eigenen Freischaltungen und nur die Kurse, die sie freigeschaltet haben.

create table if not exists public.courses (
  id            text primary key,                         -- Ablefy-Produktnummer, z. B. '473844'
  name          text not null,
  color         text not null check (color in ('white', 'black')),
  pgn           text not null,
  key_solutions jsonb not null default '{}'::jsonb,
  version       integer not null default 1,
  updated_at    timestamptz not null default now()
);

create table if not exists public.entitlements (
  email       text not null,                              -- immer klein geschrieben
  product_id  text not null,
  status      text not null default 'active' check (status in ('active', 'revoked')),
  source      text,
  updated_at  timestamptz not null default now(),
  primary key (email, product_id)
);

create table if not exists public.webhook_log (
  id          bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  source      text,
  headers     jsonb,
  body        jsonb,
  note        text
);

alter table public.courses       enable row level security;
alter table public.entitlements  enable row level security;
alter table public.webhook_log   enable row level security;

drop policy if exists my_entitlements on public.entitlements;
create policy my_entitlements on public.entitlements for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists my_courses on public.courses;
create policy my_courses on public.courses for select to authenticated
  using (exists (
    select 1 from public.entitlements e
    where e.product_id = courses.id and e.status = 'active' and e.email = lower(auth.jwt() ->> 'email')
  ));

-- Keine Rechte für anonyme Besucher; angemeldete Nutzer dürfen nur lesen (und nur ihre Zeilen, siehe Regeln oben).
-- webhook_log hat keine Regel und kein Recht: nur der Dienst-Schlüssel (Edge Function) kommt heran.
revoke all on public.courses, public.entitlements, public.webhook_log from anon, authenticated;
grant select on public.courses, public.entitlements to authenticated;
