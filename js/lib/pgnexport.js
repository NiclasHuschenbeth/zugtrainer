// Repertoire -> PGN (mit Varianten, Kommentaren, Bewertungen und Pfeilen).
import { INITIAL_FEN } from 'chessops/fen.js';

import { POS_NAGS } from './repertoire.js';

const NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const POS_NAG = Object.fromEntries(Object.entries(POS_NAGS).map(([n, s]) => [s, n]));
const BRUSH = { green: 'G', red: 'R', yellow: 'Y', blue: 'B' };

function annotation(n) {
  const parts = [];
  if (n.comment) parts.push(n.comment.replace(/[{}]/g, ''));
  if (n.shapes && n.shapes.length) {
    const code = s => (BRUSH[s.brush] || 'G') + s.orig + (s.dest || '');
    const csl = n.shapes.filter(s => !s.dest).map(code);
    const cal = n.shapes.filter(s => s.dest).map(code);
    if (csl.length) parts.push(`[%csl ${csl.join(',')}]`);
    if (cal.length) parts.push(`[%cal ${cal.join(',')}]`);
  }
  return parts.length ? ` { ${parts.join(' ')} }` : '';
}

const annotated = n => !!(n.comment || (n.shapes && n.shapes.length));

function token(n, fenBefore, force) {
  const f = fenBefore.split(' ');
  const num = f[1] === 'w' ? `${f[5]}. ` : force ? `${f[5]}... ` : '';
  return num + n.san + (n.glyph ? ` $${NAG[n.glyph]}` : '') + (n.pos && POS_NAG[n.pos] ? ` $${POS_NAG[n.pos]}` : '') + annotation(n);
}

function sequence(siblings, fenBefore, force) {
  const out = [];
  while (siblings.length) {
    const main = siblings[0];
    out.push(token(main, fenBefore, force));
    force = annotated(main);
    for (let i = 1; i < siblings.length; i++) {
      const v = siblings[i];
      const rest = sequence(v.children, v.fen, annotated(v));
      out.push(`(${token(v, fenBefore, true)}${rest ? ' ' + rest : ''})`);
      force = true;
    }
    fenBefore = main.fen;
    siblings = main.children;
  }
  return out.join(' ');
}

export function toPgn(rep) {
  return rep.chapters
    .map(ch => {
      const headers = [`[Event "${ch.name.replace(/"/g, "'")}"]`];
      if (ch.lesson) headers.push(`[Lesson "${ch.lesson.replace(/"/g, "'")}"]`);
      if (ch.priority) headers.push('[Priority "1"]');
      if (ch.startFen !== INITIAL_FEN) headers.push('[SetUp "1"]', `[FEN "${ch.startFen}"]`);
      const moves = sequence(ch.children, ch.startFen, true);
      return `${headers.join('\n')}\n\n${moves ? moves + ' ' : ''}*\n`;
    })
    .join('\n');
}

export function downloadPgn(rep) {
  const url = URL.createObjectURL(new Blob([toPgn(rep)], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rep.name.replace(/[^\wäöüÄÖÜß .-]+/g, '_')}.pgn`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
