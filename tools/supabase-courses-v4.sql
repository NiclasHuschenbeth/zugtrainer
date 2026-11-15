-- Freischaltungen: Zeitpunkt der Ablefy-Meldung (gegen veraltete Wiederholungen) und Ablaufdatum.
-- event_at:    "updated_at" der letzten verarbeiteten Meldung; ältere Meldungen werden vom Webhook ignoriert.
-- valid_until: Ablaufdatum des Zugangs (leer = unbegrenzt); die Kurs-Regel prüft es bei jedem Zugriff.
alter table public.entitlements add column if not exists event_at timestamptz;
alter table public.entitlements add column if not exists valid_until timestamptz;

drop policy if exists my_courses on public.courses;
create policy my_courses on public.courses for select to authenticated
  using (exists (
    select 1 from public.entitlements e
    where e.product_id = courses.product_id and e.status = 'active' and e.email = lower(auth.jwt() ->> 'email')
      and (e.valid_until is null or e.valid_until > now())
  ));
