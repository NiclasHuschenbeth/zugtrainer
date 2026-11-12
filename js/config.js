// Einstellungen der veröffentlichten Seite. Leere Werte blenden den jeweiligen Link aus.
export const CONFIG = {
  // Adresse des öffentlichen Quellcodes (wegen GPL-3.0 nötig), z. B. https://github.com/NAME/zugtrainer
  sourceUrl: 'https://github.com/NiclasHuschenbeth/zugtrainer',
  impressumUrl: 'https://modernchess.de/impressum/',
  datenschutzUrl: 'https://modernchess.de/datenschutz/',
  // Konten und Abgleich (Supabase). Der öffentliche Schlüssel ist für Webseiten gedacht und kein Geheimnis;
  // geschützt sind die Daten durch Zugriffsregeln in der Datenbank (siehe tools/supabase-schema.sql).
  supabaseUrl: 'https://tzfxrvrbskpqamsxktdi.supabase.co',
  supabaseKey: 'sb_publishable_01N0Ik92H-UZEnKU7C9OhA_5QpDk2Hw',
  // Auf true setzen, sobald die Anmelde-Mail einen Code enthält (eigener Mailversand + angepasste Vorlage)
  emailCode: true,
  // Bot-Schutz (Cloudflare Turnstile) vor dem Versand von Anmelde-Mails. Der Site-Key ist öffentlich.
  // Leer lassen, solange der Schutz in Supabase nicht aktiviert ist.
  turnstileSiteKey: '0x4AAAAAAF-cSftCT9xIHApm',
};
