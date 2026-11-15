// Supabase Edge Function "ablefy-webhook": nimmt Meldungen von Ablefy entgegen.
// Jede Meldung wird in webhook_log protokolliert. Das Ereignis "payer.access.changed" schaltet Kurse frei oder sperrt sie
// (Tabelle entitlements: E-Mail + Produktnummer). GRANT = aktiv, alles andere (z. B. Erstattung, Entzug) = gesperrt.
// Ein Ablaufdatum wird gespeichert (valid_until) und von der Zugriffsregel der Kurse geprüft.
// Abgesichert über ein Geheimnis in der Adresse (?key=...), das als Secret ABLEFY_WEBHOOK_SECRET hinterlegt ist.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async req => {
  const url = new URL(req.url);
  const secret = Deno.env.get('ABLEFY_WEBHOOK_SECRET');
  if (!secret || url.searchParams.get('key') !== secret) return new Response('forbidden', { status: 403 });
  if (req.method !== 'POST') return new Response('ok');

  const text = await req.text();
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  const headers = Object.fromEntries([...req.headers].filter(([k]) => !/authorization|cookie|apikey/i.test(k)));

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Für die Freischaltung unnötige Ereignisse (Lektion angesehen, Quiz beantwortet ...) gar nicht erst speichern.
  const event = String(body?.event ?? '');
  if (/^(lesson|quiz)\./.test(event)) return new Response('ok');

  let note: string | null = null;
  let failed = false;
  if (event === 'payer.access.changed') {
    const email = String(body?.payer?.email ?? '').trim().toLowerCase();
    const productId = String(body?.product?.product_id ?? '').trim();
    if (email && productId) {
      // Zeitpunkt des Ereignisses bei Ablefy: eine ältere Meldung (Wiederholung, "Neu versenden") darf eine neuere nicht überschreiben.
      const at = Date.parse(body?.updated_at ?? '');
      const eventAt = new Date(Number.isNaN(at) ? Date.now() : at).toISOString();
      const until = body?.access?.access_valid_until ? Date.parse(body.access.access_valid_until) : NaN;
      const validUntil = Number.isNaN(until) ? null : new Date(until).toISOString();
      const status = body?.access?.access_type === 'GRANT' && !(validUntil && until < Date.now()) ? 'active' : 'revoked';

      const { data: old, error: readError } = await sb
        .from('entitlements').select('event_at').eq('email', email).eq('product_id', productId).maybeSingle();
      if (readError) {
        failed = true;
        note = 'entitlement-fehler (lesen): ' + readError.message;
      } else if (old?.event_at && Date.parse(old.event_at) > Date.parse(eventAt)) {
        note = 'veraltete Meldung ignoriert (' + status + '): ' + email + ' / ' + productId;
      } else {
        const { error } = await sb.from('entitlements').upsert(
          { email, product_id: productId, status, source: 'ablefy:' + (body?.reason ?? ''), event_at: eventAt, valid_until: validUntil, updated_at: new Date().toISOString() },
          { onConflict: 'email,product_id' },
        );
        failed = !!error;
        note = error ? 'entitlement-fehler: ' + error.message : 'entitlement ' + status + ': ' + email + ' / ' + productId;
      }
    } else {
      note = 'payer.access.changed ohne E-Mail oder Produktnummer';
    }
  }

  const { error } = await sb.from('webhook_log').insert({ source: 'ablefy', headers, body, note });
  // Bei einem Fehler meldet die Funktion "error": Ablefy wiederholt die Meldung dann später.
  if (error || failed) return new Response('error', { status: 500 });
  return new Response('ok');
});
