-- Ein Ablefy-Produkt kann mehrere Repertoires enthalten (z. B. Bulletproof: Basis + Fortgeschritten).
-- courses.id = frei wählbare Kennung (z. B. '473844-basis'), courses.product_id = Ablefy-Produktnummer für die Freischaltung.
alter table public.courses add column if not exists product_id text;
update public.courses set product_id = id where product_id is null;
alter table public.courses alter column product_id set not null;

drop policy if exists my_courses on public.courses;
create policy my_courses on public.courses for select to authenticated
  using (exists (
    select 1 from public.entitlements e
    where e.product_id = courses.product_id and e.status = 'active' and e.email = lower(auth.jwt() ->> 'email')
  ));
