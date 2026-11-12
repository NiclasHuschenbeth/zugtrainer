// Abgleich: eigene Partien gegen das Repertoire laufen lassen und die erste Abweichung finden.
import { Chess } from 'chessops/chess.js';
import { makeFen } from 'chessops/fen.js';
import { parseSan, makeSan } from 'chessops/san.js';
import { derived, epdOf, moveKeys } from './repertoire.js';
import { outcomeFor } from './games.js';

/**
 * Ergebnis-Typen:
 *  you        – du hast einen anderen Zug gespielt als im Repertoire
 *  opponent   – Gegner spielte einen Zug, den das Repertoire an dieser Stelle nicht behandelt
 *  end        – Repertoire-Linie war zu Ende (du bist ihr bis zum Schluss gefolgt)
 *  complete   – Partie endete innerhalb des Repertoires
 *  notcovered – Partie hat das Repertoire nie erreicht
 */
export function analyseGame(game, index, color) {
  const pos = Chess.default();
  let entered = false;
  for (let ply = 0; ply < game.moves.length; ply++) {
    const fen = makeFen(pos.toSetup());
    const known = index.get(epdOf(fen));
    const move = parseSan(pos, game.moves[ply]);
    if (!move) break;
    if (!known) {
      if (entered) return { type: 'end', ply, fen };
    } else {
      entered = true;
      const san = makeSan(pos, move);
      if (!known.has(san)) {
        return {
          type: pos.turn === color ? 'you' : 'opponent',
          ply,
          fen,
          played: san,
          playedKeys: moveKeys(pos, move),
          expected: [...known].map(([s, k]) => ({ san: s, from: k.from, to: k.to })),
        };
      }
    }
    pos.play(move);
  }
  return entered ? { type: 'complete', ply: game.moves.length } : { type: 'notcovered', ply: 0 };
}

/** Wie oft kam jede Repertoire-Stellung in den eigenen Partien aufs Brett? Map(epd -> Anzahl Partien) */
export function positionVisits(rep, games) {
  const { index } = derived(rep);
  const visits = new Map();
  for (const g of games) {
    if (g.userColor !== rep.color) continue;
    const pos = Chess.default();
    let entered = false;
    for (const s of g.moves) {
      const epd = epdOf(makeFen(pos.toSetup()));
      const known = index.get(epd);
      if (known) {
        entered = true;
        visits.set(epd, (visits.get(epd) || 0) + 1);
      } else if (entered) break;
      const move = parseSan(pos, s);
      if (!move || (known && !known.has(makeSan(pos, move)))) break;
      pos.play(move);
    }
  }
  return visits;
}

export function compare(rep, games) {
  const { index } = derived(rep);
  const rows = games
    .filter(g => g.userColor === rep.color)
    .map(game => ({ game, res: analyseGame(game, index, rep.color) }));

  const group = type => {
    const m = new Map();
    for (const r of rows) {
      if (r.res.type !== type) continue;
      const key = `${epdOf(r.res.fen)}|${r.res.played}`;
      let e = m.get(key);
      if (!e) {
        e = { type, key, fen: r.res.fen, played: r.res.played, playedKeys: r.res.playedKeys, expected: r.res.expected, rows: [], w: 0, d: 0, l: 0 };
        m.set(key, e);
      }
      e.rows.push(r);
      e[outcomeFor(r.game)]++;
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length);
  };

  const count = t => rows.filter(r => r.res.type === t).length;
  const inBook = rows.filter(r => r.res.type !== 'notcovered');
  const avgMoves = inBook.length ? inBook.reduce((s, r) => s + r.res.ply, 0) / inBook.length / 2 : 0;

  return {
    rows,
    you: group('you'),
    opponent: group('opponent'),
    counts: {
      total: rows.length,
      you: count('you'),
      opponent: count('opponent'),
      end: count('end') + count('complete'),
      notcovered: count('notcovered'),
    },
    avgMoves,
  };
}
