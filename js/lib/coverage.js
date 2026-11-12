// Abdeckung: Welche häufigen Gegnerzüge fehlen im Repertoire?
// Grundlage ist die Lichess-Eröffnungsdatenbank auf der gewählten Spielstärke.
import { epdOf, moveLabel, turnOf } from './repertoire.js';
import { explore } from './lichess.js';

/** Stellungsgraph über alle Kapitel (Zugumstellungen fallen zusammen). */
function graph(rep) {
  const g = new Map(); // epd -> { fen, ci, path, moves: Map(san -> fen danach) }
  rep.chapters.forEach((ch, ci) => {
    const walk = (fen, nodes, path) => {
      const epd = epdOf(fen);
      let e = g.get(epd);
      if (!e) g.set(epd, (e = { fen, ci, path, moves: new Map() }));
      nodes.forEach((n, i) => {
        if (!e.moves.has(n.san)) e.moves.set(n.san, n.fen);
        walk(n.fen, n.children, [...path, i]);
      });
    };
    walk(ch.startFen, ch.children, []);
  });
  return g;
}

/** Wo steht diese Stellung im Repertoire? -> { ci, path } | null */
export function locate(rep, fen) {
  const e = graph(rep).get(epdOf(fen));
  return e ? { ci: e.ci, path: e.path } : null;
}

/** Zugfolge bis zu einer Stellung als Text, z. B. "1. e4 c5 2. Nf3". */
export function lineText(rep, ci, path) {
  const ch = rep.chapters[ci];
  let kids = ch.children;
  let fen = ch.startFen;
  const out = [];
  for (const i of path) {
    const n = kids[i];
    if (!n) break;
    const label = moveLabel(fen);
    out.push(label.endsWith('.') || !out.length ? `${label} ${n.san}` : n.san);
    fen = n.fen;
    kids = n.children;
  }
  return out.join(' ');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Geht das Repertoire von der Grundstellung aus durch, die wahrscheinlichsten Stellungen zuerst.
 * "Anteil" = Anteil aller Partien, in denen die Stellung bzw. der Zug aufs Brett kommt.
 * -> { gaps: [{ type: 'missing' | 'end' | 'answer', san, inc, share, ci, path, fen }], checked, truncated, error }
 */
export async function scanCoverage(rep, { preset, token, min, maxRequests = 150, onProgress, signal }) {
  const g = graph(rep);
  const reach = new Map();
  for (const ch of rep.chapters) reach.set(epdOf(ch.startFen), 1);
  const done = new Set();
  const gaps = [];
  let checked = 0;
  let truncated = false;
  let error = '';
  const bump = (fen, value) => {
    const epd = epdOf(fen);
    if (!done.has(epd)) reach.set(epd, Math.min(1, (reach.get(epd) || 0) + value));
  };

  while (!signal.aborted) {
    let epd = null;
    let r = 0;
    for (const [k, v] of reach) if (!done.has(k) && v > r) [epd, r] = [k, v];
    if (!epd || r < min) break;
    done.add(epd);
    const e = g.get(epd);
    if (!e) continue;

    if (turnOf(e.fen) === rep.color) {
      if (!e.moves.size) gaps.push({ type: 'answer', inc: r, ci: e.ci, path: e.path, fen: e.fen });
      for (const fen of e.moves.values()) bump(fen, r);
      continue;
    }

    if (checked >= maxRequests) {
      truncated = true;
      break;
    }
    let data;
    const t0 = performance.now();
    try {
      data = await explore(e.fen, preset, token);
    } catch (err) {
      error = err instanceof TypeError ? 'Keine Verbindung zur Lichess-Datenbank.' : err.message;
      break;
    }
    checked++;
    onProgress && onProgress(checked);
    if (performance.now() - t0 > 20) await sleep(200); // nicht aus dem Cache: Lichess schonen

    const total = data.white + data.draws + data.black;
    if (total < 50) continue; // zu wenige Partien für eine Aussage
    for (const m of data.moves) {
      const share = (m.white + m.draws + m.black) / total;
      const inc = r * share;
      const child = e.moves.get(m.san);
      if (child) bump(child, inc);
      else if (inc >= min) gaps.push({ type: e.moves.size ? 'missing' : 'end', san: m.san, inc, share, ci: e.ci, path: e.path, fen: e.fen });
    }
  }

  gaps.sort((a, b) => b.inc - a.inc);
  return { gaps, checked, truncated, error };
}
