// Kombinierte Repertoires: mehrere Repertoires (Kurse, eigene PGNs) zu einem zusammensetzen.
// Reihenfolge = Vorrang: Wo zwei Repertoires in derselben Stellung verschiedene eigene Züge haben, zählt das weiter oben.
// Ein Teil kann erst „ab einer Stellung“ gelten; die Züge bis dorthin dienen nur als Weg.
// Gegnerzüge werden zusammengeführt (alle bleiben), entschieden wird nur bei den eigenen Zügen.
// Die Quell-Repertoires bleiben unverändert; das Ergebnis wird bei jeder Änderung neu berechnet.
import { INITIAL_FEN, makeFen } from 'chessops/fen.js';
import { makeSanAndPlay, parseSan } from 'chessops/san.js';
import { epdOf, posFromFen, turnOf } from './repertoire.js';

export const isCombo = rep => !!(rep && rep.combo);

/** Zugfolge (englische SAN ab Grundstellung) -> FEN, oder null bei ungültiger Folge. */
export function fenAfter(sans) {
  let pos = posFromFen(INITIAL_FEN);
  for (const san of sans || []) {
    const m = parseSan(pos, san);
    if (!m) return null;
    makeSanAndPlay(pos, m);
  }
  return makeFen(pos.toSetup());
}

/**
 * parts: [{ rep, from: [SAN …] | null, label }] in Vorrang-Reihenfolge (erstes zählt am meisten).
 * Ergebnis: { chapters, keySolutions, stats: [{ chapters, lines }] je Teil }
 */
export function combine(color, parts) {
  const info = parts.map(p => {
    const sFen = p.from && p.from.length ? fenAfter(p.from) : null;
    return { ...p, sEpd: sFen ? epdOf(sFen) : null, own: new Map() };
  });
  // 1. Wo hat welcher Teil eigene Züge (nur innerhalb seines Geltungsbereichs)?
  for (const p of info) {
    const walk = (nodes, fenBefore, inScope) => {
      const e = epdOf(fenBefore);
      const here = inScope || !p.sEpd || e === p.sEpd;
      if (here && nodes.length && turnOf(fenBefore) === color) {
        let s = p.own.get(e);
        if (!s) p.own.set(e, (s = new Set()));
        for (const n of nodes) s.add(n.san);
      }
      for (const n of nodes) walk(n.children, n.fen, here);
    };
    for (const ch of p.rep.chapters) walk(ch.children, ch.startFen, false);
  }
  const winner = e => info.findIndex(p => p.own.has(e));

  // 2. Jeden Teil zurechtschneiden
  const chapters = [];
  const keySolutions = {};
  const stats = info.map(() => ({ chapters: 0, lines: 0 }));
  info.forEach((p, i) => {
    // liefert { nodes, hit } – hit: der Teilbaum erreicht die Startstellung des Geltungsbereichs
    const prune = (nodes, fenBefore, inScope) => {
      const e = epdOf(fenBefore);
      const here = inScope || !p.sEpd || e === p.sEpd;
      const mine = turnOf(fenBefore) === color;
      let list = nodes;
      if (mine) {
        // Ein anderer Teil entscheidet hier: nur dessen Züge bleiben (gilt auch auf dem Weg zum Geltungsbereich)
        const w = winner(e);
        if (w !== -1 && w !== i) {
          const ws = info[w].own.get(e);
          list = nodes.filter(n => ws.has(n.san));
        }
      }
      const out = [];
      let hit = here;
      for (const n of list) {
        const sub = prune(n.children, n.fen, here);
        const reaches = here || sub.hit || epdOf(n.fen) === p.sEpd;
        if (!reaches) continue; // außerhalb des Geltungsbereichs und kein Weg dorthin
        // Fortsetzung ganz von einem anderen Teil ersetzt: Zug weglassen (steht dort ohnehin schon)
        if (n.children.length && !sub.nodes.length) continue;
        hit = true;
        out.push({ ...n, children: sub.nodes });
      }
      return { nodes: out, hit };
    };
    p.rep.chapters.forEach((ch, ci) => {
      const { nodes } = prune(ch.children, ch.startFen, false);
      if (!nodes.length) return;
      // Kapitel ohne einen einzigen eigenen Zug bringen nichts
      let ownMoves = 0;
      let lines = 0;
      const count = (ns, fen) => {
        for (const n of ns) {
          if (turnOf(fen) === color) ownMoves++;
          if (!n.children.length) lines++;
          count(n.children, n.fen);
        }
      };
      count(nodes, ch.startFen);
      if (!ownMoves) return;
      const nci = chapters.length;
      chapters.push({ ...ch, children: nodes, lesson: ch.lesson ? `${p.label} · ${ch.lesson}` : p.label, source: p.rep.id });
      stats[i].chapters++;
      stats[i].lines += lines;
      // Lösungstexte der Schlüsselstellungen hängen an der Kapitelnummer
      const ks = p.rep.keySolutions;
      if (ks) {
        const pre = `${ci + 1}:`;
        for (const k of Object.keys(ks)) if (k.startsWith(pre)) keySolutions[`${nci + 1}:${k.slice(pre.length)}`] = ks[k];
      }
    });
  });
  return { chapters, keySolutions, stats };
}

// Ergebnis je kombiniertem Repertoire merken, solange sich weder die Einstellung noch die Quellen ändern
// (wichtig: dieselbe Objekt-Identität, damit die abgeleiteten Daten gecacht bleiben)
const memo = new Map();

/** Kombiniertes Repertoire mit berechneten Kapiteln. byId: Map id -> Repertoire; usable(rep): Quelle darf verwendet werden. */
export function resolveCombo(combo, byId, usable) {
  const parts = (combo.combo.parts || [])
    .map(pt => ({ pt, rep: byId.get(pt.repId) }))
    .filter(x => x.rep && !x.rep.combo && usable(x.rep) && x.rep.chapters && x.rep.chapters.length);
  const deps = [combo, ...parts.map(x => x.rep)];
  const m = memo.get(combo.id);
  if (m && m.deps.length === deps.length && m.deps.every((d, i) => d === deps[i])) return m.out;
  const r = combine(combo.color, parts.map(x => ({ rep: x.rep, from: x.pt.from, label: x.rep.name })));
  const missing = (combo.combo.parts || []).length - parts.length;
  const out = { ...combo, chapters: r.chapters, keySolutions: r.keySolutions, comboStats: r.stats, comboMissing: missing };
  memo.set(combo.id, { deps, out });
  return out;
}

/** Lernstand eines kombinierten Repertoires: aus allen Quellen und dem eigenen, je Zug der jüngste Stand. */
const pmemo = new Map();
export function comboProgress(combo, progress) {
  const ids = [combo.id, ...(combo.combo.parts || []).map(p => p.repId)];
  const maps = ids.map(id => progress[id]).filter(Boolean);
  const m = pmemo.get(combo.id);
  if (m && m.maps.length === maps.length && m.maps.every((x, i) => x === maps[i])) return m.out;
  const out = {};
  for (const mp of maps) {
    for (const k in mp) {
      const c = mp[k];
      if (!out[k] || (c.at || 0) > (out[k].at || 0)) out[k] = c;
    }
  }
  pmemo.set(combo.id, { maps, out });
  return out;
}
