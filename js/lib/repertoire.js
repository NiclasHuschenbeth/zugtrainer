// Repertoire: PGN -> Zugbaum, Linien, Stellungsindex.
import { parsePgn, startingPosition, parseComment } from 'chessops/pgn.js';
import { parseSan, makeSanAndPlay } from 'chessops/san.js';
import { makeFen, parseFen } from 'chessops/fen.js';
import { Chess } from 'chessops/chess.js';
import { makeSquare } from 'chessops/util.js';

/** Anzeige mit deutschen Figurenbuchstaben (S, L, T, D). Intern und im PGN bleibt es englisch. */
const DE = { N: 'S', B: 'L', R: 'T', Q: 'D' };
export const de = san => san.replace(/[NBRQ]/g, c => DE[c]);

export const epdOf = fen => fen.split(' ').slice(0, 4).join(' ');
export const turnOf = fen => (fen.split(' ')[1] === 'w' ? 'white' : 'black');

export function posFromFen(fen) {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

/** Zug mit Nummer: "9. De5" (Weiß) bzw. "6...Dh5" (Schwarz, ohne Leerzeichen). */
export function moveText(fenBefore, san) {
  const f = fenBefore.split(' ');
  return f[1] === 'w' ? `${f[5]}. ${de(san)}` : `${f[5]}...${de(san)}`;
}

/** "12." bzw. "12…" für den Zug, der in dieser Stellung gespielt wird. */
export function moveLabel(fenBefore) {
  const f = fenBefore.split(' ');
  return f[1] === 'w' ? `${f[5]}.` : `${f[5]}…`;
}

/** Start-/Zielfeld für Brettanzeige (Rochade: Königszielfeld). */
export function moveKeys(pos, move) {
  let to = move.to;
  const piece = pos.board.get(move.from);
  if (piece && piece.role === 'king' && pos.board[pos.turn].has(move.to)) {
    to = (move.to > move.from ? 6 : 2) + (move.from >> 3) * 8;
  }
  return [makeSquare(move.from), makeSquare(to)];
}

const NAGS = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
/** Stellungsbewertungen (PGN-NAG -> Symbol) */
export const POS_NAGS = { 10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+' };

function commentInfo(data) {
  const texts = [];
  const shapes = [];
  for (const raw of [...(data.startingComments || []), ...(data.comments || [])]) {
    const c = parseComment(raw);
    if (c.text) texts.push(c.text);
    for (const s of c.shapes) {
      const orig = makeSquare(s.from);
      const dest = makeSquare(s.to);
      shapes.push(orig === dest ? { orig, brush: s.color } : { orig, dest, brush: s.color });
    }
  }
  return { comment: texts.join(' '), shapes };
}

function build(pgnNode, pos) {
  const out = [];
  for (const child of pgnNode.children) {
    const move = parseSan(pos, child.data.san);
    if (!move) continue; // illegaler Zug: Variante ab hier ignorieren
    const [from, to] = moveKeys(pos, move);
    const next = pos.clone();
    const san = makeSanAndPlay(next, move);
    const { comment, shapes } = commentInfo(child.data);
    const node = { san, from, to, fen: makeFen(next.toSetup()), children: build(child, next) };
    if (move.promotion) node.promotion = move.promotion;
    if (comment) node.comment = comment;
    if (shapes.length) node.shapes = shapes;
    const glyph = (child.data.nags || []).map(n => NAGS[n]).find(Boolean);
    if (glyph) node.glyph = glyph;
    const posGlyph = (child.data.nags || []).map(n => POS_NAGS[n]).find(Boolean);
    if (posGlyph) node.pos = posGlyph;
    out.push(node);
  }
  return out;
}

/** PGN-Text (mehrere Partien/Kapitel, Varianten, Kommentare) -> Kapitel. */
export function parseRepertoirePgn(pgn) {
  const chapters = [];
  for (const game of parsePgn(pgn)) {
    let pos;
    try {
      pos = startingPosition(game.headers).unwrap();
    } catch {
      continue;
    }
    const children = build(game.moves, pos);
    if (!children.length) continue;
    const h = k => {
      const v = game.headers.get(k);
      return v && v !== '?' ? v : '';
    };
    const players = h('White') && h('Black') ? `${h('White')} – ${h('Black')}` : '';
    const name = h('ChapterName') || h('Event') || players || `Kapitel ${chapters.length + 1}`;
    const lesson = h('Lesson');
    const priority = parseInt(h('Priority'), 10) > 0;
    chapters.push({ name, startFen: makeFen(pos.toSetup()), children, ...(lesson ? { lesson } : {}), ...(priority ? { priority: true } : {}) });
  }
  return chapters;
}

function linesOf(rep) {
  const lines = [];
  rep.chapters.forEach((ch, ci) => {
    // alt[i]: eigener Zug ist eine Alternative (nicht die erste Fortsetzung) oder folgt auf eine solche
    const walk = (nodes, path, alt) => {
      nodes.forEach((n, sib) => {
        const p = path.concat(n);
        const mine = turnOf(p.length > 1 ? p[p.length - 2].fen : ch.startFen) === rep.color;
        const a = alt.concat(alt.some(Boolean) || (mine && sib > 0));
        if (n.children.length) walk(n.children, p, a);
        else {
          const keys = p.map((node, i) => {
            const before = i ? p[i - 1].fen : ch.startFen;
            return turnOf(before) === rep.color ? `${epdOf(before)}|${node.san}` : null;
          });
          if (keys.some(Boolean)) lines.push({ chapter: ci, startFen: ch.startFen, nodes: p, keys, alt: a });
        }
      });
    };
    walk(ch.children, [], []);
  });
  return lines;
}

function buildIndex(rep) {
  const index = new Map(); // epd -> Map(san -> {from,to})
  for (const ch of rep.chapters) {
    const walk = (fen, nodes) => {
      if (!nodes.length) return;
      const epd = epdOf(fen);
      let m = index.get(epd);
      if (!m) index.set(epd, (m = new Map()));
      for (const n of nodes) {
        if (!m.has(n.san)) m.set(n.san, { from: n.from, to: n.to });
        walk(n.fen, n.children);
      }
    };
    walk(ch.startFen, ch.children);
  }
  return index;
}

// Schlüsselstellung: Kommentar (als Satzanfang) mit diesem Wort, direkt vor dem entscheidenden Zug.
const KEY_RE = /(^|[.!?]\s+)Schl[üu]e?sselstellung\b/i;
export const isKeyComment = text => !!text && KEY_RE.test(text);
/** Text ohne das einleitende "Schlüsselstellung." (für die Anzeige im Quiz). */
export const stripKey = text => (text || '').replace(/^\s*Schl[üu]e?sselstellung\s*[.:!]?\s*/i, '').trim();

/** Alle Schlüsselstellungen, in denen der Nutzer als Nächstes zieht: Stellung, richtiger Zug, Alternativen. */
function keyPositionsOf(rep) {
  const out = [];
  const seen = new Set();
  rep.chapters.forEach((ch, ci) => {
    // Lösungstexte liegen getrennt von der PGN: rep.keySolutions["<Kapitel>:<Halbzug>:<Zug>"]
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        if (n.children.length && isKeyComment(n.comment) && turnOf(n.fen) === rep.color) {
          const id = `K:${epdOf(n.fen)}|${n.children[0].san}`;
          if (!seen.has(id)) {
            seen.add(id);
            const solution = (rep.keySolutions && rep.keySolutions[`${ci + 1}:${depth + 1}:${n.children[0].san.replace(/[+#!?]/g, '')}`]) || '';
            out.push({ id, chapter: ci, fen: n.fen, lastFrom: n.from, lastTo: n.to, text: stripKey(n.comment), solution, correct: n.children[0], alts: n.children.slice(1) });
          }
        }
        walk(n.children, depth + 1);
      }
    };
    walk(ch.children, 0);
  });
  return out;
}

const cache = new WeakMap();
/** Abgeleitete Daten (Linien, Index, Karten-Schlüssel), pro Repertoire gecacht. */
export function derived(rep) {
  let d = cache.get(rep);
  if (!d) {
    const lines = linesOf(rep);
    const keys = new Set();
    const chapterKeys = rep.chapters.map(() => new Set());
    const mainKeys = new Set(); // ohne Alternativzüge
    const chapterMainKeys = rep.chapters.map(() => new Set());
    const chapterLines = rep.chapters.map(() => 0);
    for (const l of lines) {
      chapterLines[l.chapter]++;
      for (const k of l.keys) {
        if (k) {
          keys.add(k);
          chapterKeys[l.chapter].add(k);
          if (!l.alt[l.keys.indexOf(k)]) {
            mainKeys.add(k);
            chapterMainKeys[l.chapter].add(k);
          }
        }
      }
    }
    d = { lines, index: buildIndex(rep), keys, chapterKeys, mainKeys, chapterMainKeys, chapterLines, keyPositions: keyPositionsOf(rep) };
    cache.set(rep, d);
  }
  return d;
}
