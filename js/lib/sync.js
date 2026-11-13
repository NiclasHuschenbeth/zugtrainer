// Abgleich zwischen Geräten (offline-first): lokale Kopie im Browser, gemeinsamer Stand im Konto.
// Alles hier ist unabhängig vom Server-Anbieter: `remote` ist eine kleine Schnittstelle (siehe cloud.js).
// Regeln pro Eintrag (nichts wird als Ganzes überschrieben):
//   Lernfortschritt: je Stellung gewinnt die zuletzt abgefragte Karte.
//   Tagesziel/Serie: je Tag gilt der höhere Wert.
//   Einstellungen:   der zuletzt geänderte Stand.
//   Repertoires:     der zuletzt gespeicherte Stand; wurde dasselbe Repertoire auf zwei Geräten
//                    seit dem letzten Abgleich geändert, bleibt der ältere Stand als Kopie erhalten.
//   Gelöschtes:      wird als gelöscht markiert (sonst käme es vom anderen Gerät zurück).

export const SYNC_SETTINGS = ['teach', 'sound', 'explorer', 'coverMin', 'opponent', 'cloud', 'varArrows', 'engine', 'onboarded', 'depth', 'alts', 'drillFollow'];
const DAY = 86400000;
const BATCH = 500;

export const emptySync = () => ({ userId: null, last: 0, cardsPull: 0, cardsPushed: 0, tombstones: {} });
export const repTime = r => r.updatedAt || r.createdAt || 1;
const cardTime = c => (c && c.at) || 1;

const pickSettings = s => {
  const out = {};
  for (const k of SYNC_SETTINGS) if (s[k] !== undefined) out[k] = s[k];
  out.updatedAt = s.updatedAt || 0;
  return out;
};

/** Welche Repertoires müssen vom Server geladen werden? (nur anhand der Metadaten) */
export function planDownloads(cur, meta) {
  const local = new Map(cur.repertoires.map(r => [r.id, r]));
  const tomb = cur.sync.tombstones || {};
  const need = [];
  for (const m of meta) {
    if (m.deleted) continue;
    const l = local.get(m.id);
    if (tomb[m.id] !== undefined) {
      if (tomb[m.id] < m.updated_at) need.push(m.id);
    } else if (!l || m.updated_at > repTime(l)) need.push(m.id);
  }
  return need;
}

/**
 * Führt den Server-Stand in den lokalen Stand ein (rein, ohne Netzwerk).
 * snap = { profile, meta: [{id, updated_at, deleted}], data: { [id]: repertoireObjekt }, cards: [...] }
 * -> { patch, push } ; patch = geänderte Felder von cur, push = was zum Server hochgeladen werden muss.
 */
export function merge(cur, snap, now, newId = () => crypto.randomUUID()) {
  const tomb = { ...(cur.sync.tombstones || {}) };
  let reps = [...cur.repertoires];
  let progress = { ...cur.progress };
  const push = { reps: [], deletes: [], cards: [], profile: null };
  const force = new Set(); // Repertoires, deren Karten immer hochgeladen werden (z. B. Kopien)
  const metaById = new Map(snap.meta.map(m => [m.id, m]));
  const byId = () => new Map(reps.map(r => [r.id, r]));

  for (const m of snap.meta) {
    const l = byId().get(m.id);
    if (m.deleted) {
      if (l && repTime(l) <= m.updated_at) {
        reps = reps.filter(r => r.id !== m.id);
        delete progress[m.id];
      } else if (l) push.reps.push(l); // lokal nach der Löschung weiterbearbeitet: wiederherstellen
      delete tomb[m.id];
      continue;
    }
    if (tomb[m.id] !== undefined) {
      if (tomb[m.id] >= m.updated_at) push.deletes.push({ id: m.id, ts: tomb[m.id] });
      else if (snap.data[m.id]) {
        delete tomb[m.id];
        reps.push({ ...snap.data[m.id], updatedAt: m.updated_at });
      }
      continue;
    }
    if (!l) {
      if (snap.data[m.id]) reps.push({ ...snap.data[m.id], updatedAt: m.updated_at });
    } else if (m.updated_at > repTime(l)) {
      const incoming = snap.data[m.id];
      if (!incoming) continue;
      const bothChanged = cur.sync.last > 0 && repTime(l) > cur.sync.last && m.updated_at > cur.sync.last;
      if (bothChanged) {
        // Zwei Geräte haben seit dem letzten Abgleich dasselbe Repertoire geändert: lokalen Stand als Kopie sichern
        const copy = { ...structuredClone(l), id: newId(), name: `${l.name} (Kopie ${new Date(now).toLocaleDateString('de-DE')})`, updatedAt: now };
        if (progress[l.id]) progress[copy.id] = structuredClone(progress[l.id]);
        reps.push(copy);
        push.reps.push(copy);
        force.add(copy.id);
      }
      reps = reps.map(r => (r.id === m.id ? { ...incoming, updatedAt: m.updated_at } : r));
    } else if (repTime(l) > m.updated_at) {
      push.reps.push(l);
    }
  }
  // Lokal vorhanden, auf dem Server unbekannt
  for (const l of cur.repertoires) {
    if (metaById.has(l.id)) continue;
    if (tomb[l.id] !== undefined) delete tomb[l.id]; // lokal gelöscht, nie hochgeladen
    else push.reps.push(l);
  }
  for (const id of Object.keys(tomb)) if (!metaById.has(id)) delete tomb[id];

  // Lernfortschritt: je Karte die zuletzt abgefragte Version
  const known = new Set(reps.map(r => r.id));
  const remoteSeen = new Set();
  let maxAt = cur.sync.cardsPull || 0;
  for (const c of snap.cards) {
    remoteSeen.add(`${c.rep_id}|${c.key}|${c.at}`);
    if (c.at > maxAt) maxAt = c.at;
    if (!known.has(c.rep_id)) continue;
    const mine = (progress[c.rep_id] || {})[c.key];
    if (!mine || cardTime(mine) < c.at) {
      progress[c.rep_id] = { ...(progress[c.rep_id] || {}), [c.key]: { level: c.level, due: c.due, lapses: c.lapses, at: c.at } };
    }
  }
  for (const [repId, cards] of Object.entries(progress)) {
    if (!known.has(repId)) continue;
    for (const [key, c] of Object.entries(cards)) {
      const at = cardTime(c);
      if (!force.has(repId) && at < (cur.sync.cardsPushed || 0)) continue;
      if (remoteSeen.has(`${repId}|${key}|${at}`)) continue;
      push.cards.push({ rep_id: repId, key, level: c.level, due: c.due, lapses: c.lapses || 0, at });
      if (at > maxAt) maxAt = at;
    }
  }

  // Tagesziel und Serie
  const rp = snap.profile;
  const ra = (rp && rp.activity) || {};
  const la = cur.activity;
  const days = { ...la.days };
  for (const [d, n] of Object.entries(ra.days || {})) if (n > (days[d] || 0)) days[d] = n;
  const activity = { ...la, days };
  if (ra.goal && (ra.updatedAt || 0) > (la.updatedAt || 0)) {
    activity.goal = ra.goal;
    activity.updatedAt = ra.updatedAt;
  }
  // Einstellungen: der zuletzt geänderte Stand
  const rs = (rp && rp.settings) || {};
  let settings = cur.settings;
  if ((rs.updatedAt || 0) > (cur.settings.updatedAt || 0)) {
    const take = {};
    for (const k of SYNC_SETTINGS) if (rs[k] !== undefined) take[k] = rs[k];
    settings = { ...cur.settings, ...take, updatedAt: rs.updatedAt };
  }
  const wantProfile = {
    activity: { goal: activity.goal, days: activity.days, updatedAt: activity.updatedAt || 0 },
    settings: pickSettings(settings),
  };
  if (!rp || JSON.stringify(wantProfile.activity) !== JSON.stringify(ra) || JSON.stringify(wantProfile.settings) !== JSON.stringify(rs)) {
    push.profile = wantProfile;
  }

  return {
    patch: { repertoires: reps, progress, activity, settings, sync: { ...cur.sync, tombstones: tomb, cardsPull: maxAt } },
    push,
  };
}

/** Ein kompletter Abgleich. `update(fn)` wendet fn(aktuellerStand) => Patch an und gibt nichts zurück. */
export async function runSync({ getDb, update, remote, userId, now = Date.now() }) {
  const start = now;
  const first = getDb();
  if (first.sync.userId && first.sync.userId !== userId) throw new Error('Anderes Konto auf diesem Gerät');

  const [profile, meta, cards] = await Promise.all([
    remote.getProfile(),
    remote.listReps(),
    remote.pullCards(Math.max(0, (first.sync.cardsPull || 0) - DAY)),
  ]);
  const need = planDownloads(first, meta);
  const data = need.length ? await remote.getReps(need) : {};
  const snap = { profile, meta, data, cards };

  let out;
  update(cur => {
    const r = merge(cur, snap, start);
    out = r.push;
    return r.patch;
  });

  if (out.reps.length) {
    await remote.putReps(out.reps.map(r => ({ id: r.id, data: r, updated_at: repTime(r), deleted: false })));
  }
  for (const d of out.deletes) {
    await remote.putReps([{ id: d.id, data: null, updated_at: d.ts, deleted: true }]);
    await remote.deleteCards(d.id);
  }
  for (let i = 0; i < out.cards.length; i += BATCH) await remote.pushCards(out.cards.slice(i, i + BATCH));
  if (out.profile) await remote.putProfile(out.profile);

  update(cur => {
    const tomb = { ...cur.sync.tombstones };
    for (const d of out.deletes) if (tomb[d.id] === d.ts) delete tomb[d.id];
    return { sync: { ...cur.sync, userId, last: start, cardsPushed: start, tombstones: tomb } };
  });
  return { pushedReps: out.reps.length, pushedCards: out.cards.length, pulledReps: need.length, pulledCards: cards.length };
}
