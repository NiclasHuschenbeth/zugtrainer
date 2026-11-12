// Prüft den Abgleich (js/lib/sync.js) mit zwei simulierten Geräten und einem Fake-Server.
// Im Browser ausführen: await (await import('/tools/sync-test.mjs')).run()
import { emptySync, runSync } from '../js/lib/sync.js';

function fakeServer() {
  const reps = new Map(); // id -> { id, data, updated_at, deleted }
  const cards = new Map(); // rep|key -> row
  let profile = null;
  return {
    reps, cards,
    get profile() { return profile; },
    remote: {
      async getProfile() { return profile ? structuredClone(profile) : null; },
      async putProfile(p) { profile = structuredClone(p); },
      async listReps() { return [...reps.values()].map(r => ({ id: r.id, updated_at: r.updated_at, deleted: r.deleted })); },
      async getReps(ids) { const o = {}; for (const id of ids) { const r = reps.get(id); if (r && r.data) o[id] = structuredClone(r.data); } return o; },
      async putReps(rows) { for (const r of rows) reps.set(r.id, structuredClone(r)); },
      async pullCards(since) { return [...cards.values()].filter(c => c.at > since).map(c => ({ ...c })); },
      async pushCards(rows) { for (const r of rows) cards.set(`${r.rep_id}|${r.key}`, { ...r }); },
      async deleteCards(repId) { for (const k of [...cards.keys()]) if (k.startsWith(repId + '|')) cards.delete(k); },
    },
  };
}

function device(name) {
  const d = {
    name,
    db: {
      repertoires: [], progress: {}, activity: { goal: 20, days: {} },
      settings: { teach: true, sound: true, explorer: 'all', lichessToken: null }, sync: emptySync(),
    },
  };
  d.update = fn => { d.db = { ...d.db, ...(typeof fn === 'function' ? fn(d.db) : fn) }; };
  d.sync = (server, now) => runSync({ getDb: () => d.db, update: d.update, remote: server.remote, userId: 'u1', now });
  return d;
}

const rep = (id, name, t) => ({ id, name, color: 'white', chapters: [{ name: 'K1', startFen: 'x', children: [] }], createdAt: t, updatedAt: t });
const card = (level, at) => ({ level, due: at + 1000, lapses: 0, at });

export async function run() {
  const results = [];
  const ok = (cond, msg) => results.push({ ok: !!cond, msg });
  const S = fakeServer();
  const A = device('A');
  const B = device('B');
  const R = '11111111-1111-4111-8111-111111111111';

  // 1) A legt Repertoire an, lernt zwei Züge, gleicht ab
  A.db.repertoires = [rep(R, 'Sizilianisch', 1000)];
  A.db.progress = { [R]: { 'k1|e4': card(1, 1100), 'k2|d4': card(2, 1200) } };
  A.db.activity = { goal: 20, days: { '2026-11-10': 10 } };
  await A.sync(S, 2000);
  ok(S.reps.size === 1 && S.cards.size === 2, '1) Repertoire und 2 Karten liegen auf dem Server');

  // 2) B ist leer und gleicht ab -> bekommt alles
  await B.sync(S, 3000);
  ok(B.db.repertoires.length === 1 && B.db.repertoires[0].name === 'Sizilianisch', '2) B hat das Repertoire');
  ok(Object.keys(B.db.progress[R] || {}).length === 2, '2) B hat beide Karten');
  ok(B.db.activity.days['2026-11-10'] === 10, '2) B hat die Tageszahl');

  // 3) Beide lernen unterschiedliche Züge, B auch einen Zug, den A älter hat
  B.update(cur => ({ progress: { ...cur.progress, [R]: { ...cur.progress[R], 'k2|d4': card(5, 4100), 'k3|c4': card(1, 4150) } }, activity: { ...cur.activity, days: { ...cur.activity.days, '2026-11-10': 15 } } }));
  A.update(cur => ({ progress: { ...cur.progress, [R]: { ...cur.progress[R], 'k1|e4': card(3, 4200) } }, activity: { ...cur.activity, days: { ...cur.activity.days, '2026-11-10': 12, '2026-11-11': 4 } } }));
  await B.sync(S, 5000);
  await A.sync(S, 6000);
  await B.sync(S, 7000);
  const pa = A.db.progress[R], pb = B.db.progress[R];
  ok(JSON.stringify(pa) === JSON.stringify(pb), '3) Beide Geräte haben denselben Lernstand');
  ok(pa['k2|d4'].level === 5 && pa['k1|e4'].level === 3 && pa['k3|c4'], '3) Je Karte gewinnt die neuere Abfrage');
  ok(A.db.activity.days['2026-11-10'] === 15 && B.db.activity.days['2026-11-11'] === 4, '3) Tagesziel: je Tag der höhere Wert');

  // 4) Zugumstellung: gleiche Karte mit älterem Zeitstempel überschreibt nichts
  A.update(cur => ({ progress: { ...cur.progress, [R]: { ...cur.progress[R], 'k3|c4': card(8, 100) } } }));
  await A.sync(S, 8000);
  await B.sync(S, 9000);
  ok(B.db.progress[R]['k3|c4'].level === 1 || B.db.progress[R]['k3|c4'].level === 8, '4) Karte bleibt konsistent');

  // 5) Löschen auf A -> verschwindet auf B, Karten werden auf dem Server entfernt
  A.update(cur => {
    const progress = { ...cur.progress }; delete progress[R];
    return { repertoires: [], progress, sync: { ...cur.sync, tombstones: { ...cur.sync.tombstones, [R]: 10000 } } };
  });
  await A.sync(S, 11000);
  await B.sync(S, 12000);
  ok(B.db.repertoires.length === 0 && !B.db.progress[R], '5) Gelöschtes Repertoire verschwindet auch auf B');
  ok([...S.cards.keys()].every(k => !k.startsWith(R)), '5) Karten des gelöschten Repertoires sind vom Server entfernt');
  ok(S.reps.get(R).deleted === true, '5) Auf dem Server als gelöscht markiert');
  await A.sync(S, 13000);
  ok(A.db.repertoires.length === 0 && Object.keys(A.db.sync.tombstones).length === 0, '5) Löschmarke ist aufgeräumt');

  // 6) Gleichzeitige Bearbeitung desselben Repertoires: älterer Stand bleibt als Kopie
  const R2 = '22222222-2222-4222-8222-222222222222';
  A.update({ repertoires: [rep(R2, 'Französisch', 20000)] });
  await A.sync(S, 21000);
  await B.sync(S, 22000);
  B.update(cur => ({ repertoires: cur.repertoires.map(r => (r.id === R2 ? { ...r, name: 'Französisch (B)', updatedAt: 23000 } : r)) }));
  A.update(cur => ({ repertoires: cur.repertoires.map(r => (r.id === R2 ? { ...r, name: 'Französisch (A)', updatedAt: 24000 } : r)) }));
  await A.sync(S, 25000);
  await B.sync(S, 26000);
  ok(B.db.repertoires.some(r => r.id === R2 && r.name === 'Französisch (A)'), '6) Der neuere Stand (A) gilt');
  ok(B.db.repertoires.some(r => r.name.startsWith('Französisch (B) (Kopie')), '6) Der ältere Stand (B) bleibt als Kopie erhalten');
  await A.sync(S, 27000);
  ok(A.db.repertoires.length === 2 && A.db.repertoires.length === B.db.repertoires.length, '6) Beide Geräte haben danach dieselben zwei Repertoires');

  // 7) Einstellungen: Token wird nie hochgeladen, neuere Einstellung gewinnt
  A.update(cur => ({ settings: { ...cur.settings, sound: false, lichessToken: 'GEHEIM', updatedAt: 30000 } }));
  await A.sync(S, 31000);
  await B.sync(S, 32000);
  ok(JSON.stringify(S.profile).indexOf('GEHEIM') < 0, '7) Lichess-Token landet nicht auf dem Server');
  ok(B.db.settings.sound === false && B.db.settings.lichessToken === null, '7) Einstellung übernommen, Token bleibt lokal');

  // 8) Nichts zu tun: zweiter Abgleich lädt kaum etwas hoch
  const r = await A.sync(S, 40000);
  ok(r.pushedReps === 0 && r.pushedCards === 0, '8) Ohne Änderungen wird nichts hochgeladen (' + JSON.stringify(r) + ')');

  // 9) Gerät mit lokalen Daten meldet sich an einem leeren Konto an: alles wird hochgeladen
  const S2 = fakeServer();
  const C = device('C');
  C.db.repertoires = [rep('33333333-3333-4333-8333-333333333333', 'Lokal', 50000)];
  C.db.progress = { '33333333-3333-4333-8333-333333333333': { 'k|e4': card(1, 50100) } };
  await C.sync(S2, 51000);
  ok(S2.reps.size === 1 && S2.cards.size === 1, '9) Lokale Daten werden beim ersten Abgleich ins Konto übernommen');

  const failed = results.filter(x => !x.ok);
  return { passed: results.length - failed.length, total: results.length, failed, all: results.map(x => (x.ok ? '✓ ' : '✗ ') + x.msg) };
}
