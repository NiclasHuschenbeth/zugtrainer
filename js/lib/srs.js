// Spaced Repetition: pro Zug (Stellung + Zug) eine Karte mit Stufe und Fälligkeit.
import { derived, epdOf } from './repertoire.js';

// Tagesaktivität: { goal: Züge pro Tag, days: { 'JJJJ-MM-TT': Anzahl abgefragter Züge } }
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Tage in Folge mit erreichtem Tagesziel (heute zählt, sobald es erreicht ist). */
export function streakOf(activity) {
  const hit = d => (activity.days[dayKey(d)] || 0) >= activity.goal;
  const d = new Date();
  if (!hit(d)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (hit(d)) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function lastDays(activity, count = 7) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({ label: d.toLocaleDateString('de-DE', { weekday: 'short' }), n: activity.days[dayKey(d)] || 0 });
  }
  return out;
}

const H = 3600 * 1000;
// Stufe 1..8: 4 Std, 1 Tag, 3 Tage, 1 Woche, 2 Wochen, 1 Monat, 3 Monate, 6 Monate
export const INTERVALS = [0, 4 * H, 24 * H, 72 * H, 168 * H, 336 * H, 720 * H, 2160 * H, 4320 * H];
export const MAX_LEVEL = 8;

export function gradeCard(card, ok, mode, now = Date.now()) {
  const prev = card || { level: 0, lapses: 0 };
  let level;
  if (mode === 'learn') level = 1;
  else level = ok ? Math.min(prev.level + 1, MAX_LEVEL) : 1;
  // at = Zeitpunkt der letzten Abfrage (für den späteren Abgleich zwischen Geräten)
  return { level, due: now + INTERVALS[level], lapses: prev.lapses + (ok ? 0 : 1), at: now };
}

// Lernauswahl: 'all' | 'prio' | 'lesson:<Name>' -> Menge der Kapitel-Nummern (null = alle)
export const hasPriority = rep => rep.chapters.some(c => c.priority);
export const lessonsOf = rep => [...new Set(rep.chapters.map(c => c.lesson).filter(Boolean))];
export const scopeOf = (settings, rep) => (settings.scopes && settings.scopes[rep.id]) || 'all';
export const keyScopeOf = (settings, rep) => (settings.keyScopes && settings.keyScopes[rep.id]) || 'all';
export function scopeChapters(rep, scope) {
  if (!scope || scope === 'all') return null;
  const set = new Set();
  rep.chapters.forEach((c, i) => {
    if (scope === 'prio' ? c.priority : scope.startsWith('lesson:') && c.lesson === scope.slice(7)) set.add(i);
  });
  return set.size ? set : null;
}

/** Schlüsselstellungen im gewählten Bereich: Anzahl, fällige und neue. */
export function keyStats(rep, progress, scope = null, now = Date.now()) {
  const sc = scopeChapters(rep, scope);
  const list = derived(rep).keyPositions.filter(k => !sc || sc.has(k.chapter));
  let due = 0;
  let fresh = 0;
  for (const k of list) {
    const c = progress[k.id];
    if (!c) fresh++;
    else if (c.due <= now) due++;
  }
  return { total: list.length, due, fresh };
}

/** Aufgaben einer Schlüsselstellungen-Sitzung: erst fällige, dann neue (Prioritäten zuerst). */
export function buildKeyTasks(rep, progress, opts = {}) {
  const { scope = null, size = 10, shuffle = false, now = Date.now() } = opts;
  const sc = scopeChapters(rep, scope);
  const list = derived(rep).keyPositions.filter(k => !sc || sc.has(k.chapter));
  const due = list.filter(k => progress[k.id] && progress[k.id].due <= now).sort((a, b) => progress[a.id].due - progress[b.id].due);
  let fresh = list.filter(k => !progress[k.id]);
  if (hasPriority(rep) && scope !== 'order') {
    fresh = fresh.map((k, n) => ({ k, n })).sort((a, b) => (rep.chapters[a.k.chapter].priority ? 0 : 1) - (rep.chapters[b.k.chapter].priority ? 0 : 1) || a.n - b.n).map(x => x.k);
  }
  let pick = [...due, ...fresh];
  if (size > 0) pick = pick.slice(0, size);
  if (shuffle) {
    for (let i = pick.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pick[i], pick[j]] = [pick[j], pick[i]];
    }
  }
  return pick;
}

export function repStats(rep, progress, alts = false, scope = null, now = Date.now()) {
  const d = derived(rep);
  const keys = alts ? d.keys : d.mainKeys;
  const chapterKeys = alts ? d.chapterKeys : d.chapterMainKeys;
  const sc = scopeChapters(rep, scope);
  const dueKeys = sc ? new Set([...sc].flatMap(i => [...chapterKeys[i]])) : keys;
  let learned = 0;
  let due = 0;
  for (const k of keys) {
    const c = progress[k];
    if (c) learned++;
  }
  for (const k of dueKeys) {
    const c = progress[k];
    if (c && c.due <= now) due++;
  }
  const chapters = rep.chapters.map((ch, i) => {
    let l = 0;
    for (const k of chapterKeys[i]) if (progress[k]) l++;
    return { name: ch.name, lines: d.chapterLines[i], total: chapterKeys[i].size, learned: l };
  });
  return { lines: d.lines.length, total: keys.size, learned, due, chapters };
}

export const DEPTHS = [5, 8, 10, 12, 15, 0]; // 0 = alle

/** Zugnummer (ganzer Zug) des i-ten Zugs einer Linie. */
const moveNo = (line, i) => parseInt((i ? line.nodes[i - 1].fen : line.startFen).split(' ')[5], 10) || 1;
/** Zugbereich einer Linie: je Kapitel überschreibbar (ranges[kapitel] = { from, to }, to 0 = bis Ende), sonst global. */
const inDepth = (line, i, depth, from = 1, ranges = null) => {
  const r = ranges && ranges[line.chapter];
  const lo = r ? r.from || 1 : from;
  const hi = r ? r.to || 0 : depth;
  const n = moveNo(line, i);
  return (!hi || n <= hi) && n >= lo;
};

/** Anzahl neuer Züge, die bei dieser Tiefe (bis Zug N, 0 = alle) und ab Zug `from` noch zu lernen sind. */
export function freshCount(rep, progress, depth = 0, alts = false, scope = null, from = 1, ranges = null) {
  const seen = new Set();
  const sc = scopeChapters(rep, scope);
  for (const line of derived(rep).lines) {
    if (sc && !sc.has(line.chapter)) continue;
    line.keys.forEach((k, i) => {
      if (k && !progress[k] && inDepth(line, i, depth, from, ranges) && (alts || !line.alt[i])) seen.add(k);
    });
  }
  return seen.size;
}

/**
 * Aufgaben einer Sitzung. Jede Aufgabe: eine Linie + Indizes der abzufragenden Züge.
 * mode: 'learn' (neue Züge), 'review' (fällige Züge), 'practice' (Linie mit bestimmtem Zug).
 */
export function buildTasks(rep, progress, mode, opts = {}) {
  const { lines } = derived(rep);
  const now = Date.now();
  const tasks = [];
  const seen = new Set();

  if (mode === 'practice' && Array.isArray(opts.key)) {
    // Fehler-Training: pro Schlüssel genau dieser eine Zug
    const used = new Set();
    for (const key of opts.key) {
      if (used.has(key)) continue;
      const line = lines.find(l => l.keys.includes(key));
      if (!line) continue;
      used.add(key);
      tasks.push({ line, ask: [line.keys.indexOf(key)] });
    }
    return tasks;
  }

  if (mode === 'practice') {
    const line = lines.find(l => l.keys.includes(opts.key));
    if (line) tasks.push({ line, ask: line.keys.map((k, i) => (k ? i : -1)).filter(i => i >= 0) });
    return tasks;
  }

  // Lernen: Linien zuerst, deren neue Züge in den eigenen Partien am häufigsten aufs Brett kamen.
  let ordered = lines;
  if (mode === 'learn' && opts.visits && opts.visits.size) {
    const weight = line => {
      let w = 0;
      line.keys.forEach((k, i) => {
        if (k && !progress[k]) w += opts.visits.get(epdOf(i ? line.nodes[i - 1].fen : line.startFen)) || 0;
      });
      return w;
    };
    ordered = lines
      .map((l, n) => ({ l, n, w: weight(l) }))
      .sort((a, b) => b.w - a.w || a.n - b.n)
      .map(x => x.l);
  }

  // Prioritäts-Kapitel zuerst (sonst bleibt die bisherige Reihenfolge)
  if (hasPriority(rep) && opts.scope !== 'order') {
    ordered = ordered
      .map((l, n) => ({ l, n }))
      .sort((a, b) => (rep.chapters[a.l.chapter].priority ? 0 : 1) - (rep.chapters[b.l.chapter].priority ? 0 : 1) || a.n - b.n)
      .map(x => x.l);
  }
  const sc = scopeChapters(rep, opts.scope);
  const limit = mode === 'learn' ? opts.limit || 5 : Infinity;
  for (const line of ordered) {
    if (opts.chapter != null && line.chapter !== opts.chapter) continue;
    if (sc && !sc.has(line.chapter)) continue;
    const ask = [];
    line.keys.forEach((k, i) => {
      if (!k || seen.has(k)) return;
      if (mode === 'learn' && !inDepth(line, i, opts.depth, opts.from || 1, opts.ranges)) return;
      if (!opts.alts && line.alt[i] && mode !== 'practice') return;
      const c = progress[k];
      if (mode === 'learn' ? !c : c && c.due <= now) ask.push(i);
    });
    if (!ask.length) continue;
    ask.forEach(i => seen.add(line.keys[i]));
    tasks.push({ line, ask });
    if (tasks.length >= limit) break;
  }
  return tasks;
}
