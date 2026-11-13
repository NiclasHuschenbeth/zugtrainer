// Supabase Edge Function "ablefy-webhook": nimmt Meldungen von Ablefy entgegen.
// Jede Meldung wird in webhook_log protokolliert. Das Ereignis "payer.access.changed" schaltet Kurse frei oder sperrt sie
// (Tabelle entitlements: E-Mail + Produktnummer). GRANT = aktiv, alles andere (z. B. Erstattung, Entzug) = gesperrt.
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

  let note: string | null = null;
  if (body?.event === 'payer.access.changed') {
    const email = String(body?.payer?.email ?? '').trim().toLowerCase();
    const productId = String(body?.product?.product_id ?? '').trim();
    if (email && productId) {
      const until = body?.access?.access_valid_until ? Date.parse(body.access.access_valid_until) : NaN;
      const expired = !Number.isNaN(until) && until < Date.now();
      const status = body?.access?.access_type === 'GRANT' && !expired ? 'active' : 'revoked';
      const { error } = await sb.from('entitlements').upsert(
        { email, product_id: productId, status, source: 'ablefy:' + (body?.reason ?? ''), updated_at: new Date().toISOString() },
        { onConflict: 'email,product_id' },
      );
      note = error ? 'entitlement-fehler: ' + error.message : 'entitlement ' + status + ': ' + email + ' / ' + productId;
    } else {
      note = 'payer.access.changed ohne E-Mail oder Produktnummer';
    }
  }

  const { error } = await sb.from('webhook_log').insert({ source: 'ablefy', headers, body, note });
  if (error) return new Response('error', { status: 500 }); // Ablefy wiederholt dann
  return new Response('ok');
});
