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

export function repStats(rep, progress, now = Date.now()) {
  const d = derived(rep);
  let learned = 0;
  let due = 0;
  for (const k of d.keys) {
    const c = progress[k];
    if (c) {
      learned++;
      if (c.due <= now) due++;
    }
  }
  const chapters = rep.chapters.map((ch, i) => {
    let l = 0;
    for (const k of d.chapterKeys[i]) if (progress[k]) l++;
    return { name: ch.name, lines: d.chapterLines[i], total: d.chapterKeys[i].size, learned: l };
  });
  return { lines: d.lines.length, total: d.keys.size, learned, due, chapters };
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

  const limit = mode === 'learn' ? opts.limit || 5 : Infinity;
  for (const line of ordered) {
    if (opts.chapter != null && line.chapter !== opts.chapter) continue;
    const ask = [];
    line.keys.forEach((k, i) => {
      if (!k || seen.has(k)) return;
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
