// Import eigener Partien über die öffentlichen APIs von Lichess und Chess.com.
import { parsePgn } from 'chessops/pgn.js';

export async function fetchLichess(user, max, onProgress) {
  const name = user.trim();
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(name)}` +
    `?max=${max}&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;
  const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error('Lichess-Nutzer nicht gefunden.');
  if (res.status === 429) throw new Error('Lichess-Limit erreicht – bitte eine Minute warten.');
  if (!res.ok) throw new Error(`Lichess antwortet mit Fehler ${res.status}.`);

  const games = [];
  const add = line => {
    if (!line.trim()) return;
    const g = fromLichess(JSON.parse(line), name.toLowerCase());
    if (g) games.push(g);
    if (onProgress) onProgress(games.length);
  };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      add(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  add(buf);
  return games;
}

function fromLichess(j, userId) {
  if (j.variant !== 'standard' || !j.moves) return null;
  const side = c => j.players && j.players[c] ? j.players[c] : {};
  const nameOf = p => (p.user ? p.user.name : p.aiLevel ? `Stockfish Stufe ${p.aiLevel}` : 'Anonym');
  const w = side('white');
  const b = side('black');
  const userColor =
    w.user && w.user.id === userId ? 'white' : b.user && b.user.id === userId ? 'black' : null;
  if (!userColor) return null;
  return {
    id: `lichess:${j.id}`,
    source: 'lichess',
    url: `https://lichess.org/${j.id}`,
    white: nameOf(w),
    black: nameOf(b),
    whiteElo: w.rating || null,
    blackElo: b.rating || null,
    result: j.winner === 'white' ? '1-0' : j.winner === 'black' ? '0-1' : '1/2-1/2',
    date: j.createdAt,
    speed: j.speed,
    userColor,
    moves: j.moves.split(' '),
  };
}

export async function fetchChessCom(user, max, onProgress) {
  const u = user.trim().toLowerCase();
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
  if (res.status === 404) throw new Error('Chess.com-Nutzer nicht gefunden.');
  if (!res.ok) throw new Error(`Chess.com antwortet mit Fehler ${res.status}.`);
  const { archives = [] } = await res.json();

  const games = [];
  for (let i = archives.length - 1; i >= 0 && games.length < max; i--) {
    const r = await fetch(archives[i]);
    if (!r.ok) continue;
    const month = (await r.json()).games || [];
    for (let k = month.length - 1; k >= 0 && games.length < max; k--) {
      const g = fromChessCom(month[k], u);
      if (g) games.push(g);
    }
    if (onProgress) onProgress(games.length);
  }
  return games;
}

function fromChessCom(g, u) {
  if (g.rules !== 'chess' || !g.pgn) return null;
  const isW = g.white && g.white.username.toLowerCase() === u;
  const isB = g.black && g.black.username.toLowerCase() === u;
  if (!isW && !isB) return null;
  const parsed = parsePgn(g.pgn)[0];
  if (!parsed) return null;
  if (parsed.headers.get('FEN')) return null; // keine Standard-Grundstellung
  const moves = [...parsed.moves.mainline()].map(d => d.san);
  if (!moves.length) return null;
  const result = g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : '1/2-1/2';
  return {
    id: `chesscom:${g.uuid || g.url}`,
    source: 'chesscom',
    url: g.url,
    white: g.white.username,
    black: g.black.username,
    whiteElo: g.white.rating || null,
    blackElo: g.black.rating || null,
    result,
    date: (g.end_time || 0) * 1000,
    speed: g.time_class,
    userColor: isW ? 'white' : 'black',
    moves,
  };
}

/** Neue Partien zu den gespeicherten hinzufügen (ohne Duplikate, neueste zuerst). */
export function mergeGames(existing, incoming) {
  const byId = new Map(existing.map(g => [g.id, g]));
  let added = 0;
  for (const g of incoming) {
    if (!byId.has(g.id)) added++;
    byId.set(g.id, g);
  }
  return { games: [...byId.values()].sort((a, b) => b.date - a.date), added };
}

export function outcomeFor(game) {
  if (game.result === '1/2-1/2') return 'd';
  return (game.result === '1-0') === (game.userColor === 'white') ? 'w' : 'l';
}
