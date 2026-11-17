// Referenz im Analyse-Brett: Welche Züge stehen in einer Stellung in den eigenen Repertoires (Kurse, hochgeladene, eigene)?
// Gesucht wird nach Stellung, nicht nach Zugfolge: Zugumstellungen werden also erkannt.
import { epdOf, turnOf } from './repertoire.js';

/** Autor eines Repertoires: eingetragen, sonst bei Modern-Chess-Kursen Niclas Huschenbeth. */
export const authorOf = rep => rep.author || (String(rep.id).startsWith('course-') ? 'Niclas Huschenbeth' : '');

/** Autor aus den PGN-Kopfzeilen (Annotator oder Author), sonst ''. */
export function pgnAuthor(pgn) {
  const m = /\[(?:Annotator|Author)\s+"([^"]*)"\]/i.exec(pgn || '');
  const v = m ? m[1].trim() : '';
  return v && v !== '?' ? v : '';
}

const cache = new WeakMap();
/**
 * Stellungsverzeichnis eines Repertoires:
 * moves: epd -> [{ san, main, own, chapter, comment }]  (main = erste Fortsetzung; own = Zug der Repertoire-Farbe)
 * ends:  epd -> Kapitelname (Stellungen, in denen eine Linie endet)
 */
export function refIndex(rep) {
  let r = cache.get(rep);
  if (r) return r;
  const moves = new Map();
  const ends = new Map();
  for (const ch of rep.chapters || []) {
    const walk = (fen, nodes) => {
      const epd = epdOf(fen);
      if (!nodes.length) {
        if (!ends.has(epd)) ends.set(epd, ch.name);
        return;
      }
      let list = moves.get(epd);
      if (!list) moves.set(epd, (list = []));
      const own = turnOf(fen) === rep.color;
      nodes.forEach((n, i) => {
        const old = list.find(x => x.san === n.san);
        if (!old) list.push({ san: n.san, main: i === 0, own, chapter: ch.name, comment: n.comment || '' });
        else {
          if (i === 0) old.main = true;
          if (!old.comment && n.comment) old.comment = n.comment;
        }
        walk(n.fen, n.children);
      });
    };
    walk(ch.startFen, ch.children);
  }
  // Eigene Züge: Hauptzug zuerst. Gegnerzüge bleiben in der Reihenfolge des Kurses.
  for (const list of moves.values()) if (list[0] && list[0].own) list.sort((a, b) => b.main - a.main);
  r = { moves, ends };
  cache.set(rep, r);
  return r;
}

/** Treffer für eine Stellung: [{ rep, moves: [...], end: Kapitelname | null }] (nur Repertoires mit Treffer). */
export function refsAt(reps, fen) {
  const epd = epdOf(fen);
  const out = [];
  for (const rep of reps) {
    const idx = refIndex(rep);
    const moves = idx.moves.get(epd) || [];
    const end = !moves.length && idx.ends.has(epd) ? idx.ends.get(epd) : null;
    if (moves.length || end) out.push({ rep, moves, end });
  }
  return out;
}

/** Index der letzten Stellung im Verlauf (0 = Ausgangsstellung), die noch in einem Repertoire vorkommt, sonst -1. */
export function lastKnown(reps, fens) {
  for (let i = fens.length - 1; i >= 0; i--) {
    const epd = epdOf(fens[i]);
    if (reps.some(rep => refIndex(rep).moves.has(epd) || refIndex(rep).ends.has(epd))) return i;
  }
  return -1;
}
