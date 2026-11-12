// Cloud-Bewertungen aus der Chess Cloud Database (chessdb.cn). Kein Login nötig.
const API = 'https://www.chessdb.cn/cdb.php';
const cache = new Map();

async function call(action, fen) {
  const q = new URLSearchParams({ action, board: fen, json: '1' });
  const res = await fetch(`${API}?${q}`);
  if (!res.ok) throw new Error(`ChessDB antwortet mit Fehler ${res.status}.`);
  return res.json();
}

/**
 * Alle bekannten Züge einer Stellung.
 * -> { status: 'ok' | 'unknown' | 'checkmate' | 'stalemate' | 'invalid board', moves: [{ san, uci, cp, rank }] }
 * cp ist aus Sicht von Weiß (wie bei Stockfish im Editor), rank: 2 = bester Zug, 1 = gut, 0 = schwächer.
 */
export async function cdbMoves(fen) {
  if (cache.has(fen)) return cache.get(fen);
  const data = await call('queryall', fen);
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  const out = {
    status: data.status,
    moves: (data.moves || []).map(m => ({ san: m.san, uci: m.uci, cp: sign * m.score, rank: m.rank })),
  };
  if (out.status === 'ok') cache.set(fen, out);
  return out;
}

/** Unbekannte Stellung zur Analyse einreihen. */
export const cdbQueue = fen => call('queue', fen);

export function formatCloud(cp) {
  if (Math.abs(cp) > 15000) return cp > 0 ? '#' : '-#';
  const v = cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
