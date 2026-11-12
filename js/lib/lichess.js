// Lichess-Anmeldung (OAuth mit PKCE, ohne Server) und Eröffnungsdatenbank.
const CLIENT_ID = 'zugtrainer';
const redirectUri = () => location.origin + location.pathname;
const b64url = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Leitet zu Lichess weiter. returnTo wird nach der Rückkehr wiederhergestellt. */
export async function startLogin(returnTo) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('zt-oauth', JSON.stringify({ verifier, state, returnTo }));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.href = `https://lichess.org/oauth?${q}`;
}

/** Beim Laden der Seite aufrufen: tauscht ?code=… gegen ein Token. -> { token, returnTo } | null */
export async function finishLogin() {
  const p = new URLSearchParams(location.search);
  if (!p.get('code') && !p.get('error')) return null;
  const saved = JSON.parse(sessionStorage.getItem('zt-oauth') || 'null');
  sessionStorage.removeItem('zt-oauth');
  history.replaceState(null, '', redirectUri());
  if (!p.get('code') || !saved || saved.state !== p.get('state')) return null;
  try {
    const res = await fetch('https://lichess.org/api/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: p.get('code'),
        code_verifier: saved.verifier,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID,
      }),
    });
    if (!res.ok) return null;
    return { token: (await res.json()).access_token, returnTo: saved.returnTo };
  } catch {
    return null;
  }
}

export const PRESETS = {
  all: { label: 'Lichess – alle Spielstärken', db: 'lichess', ratings: [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500] },
  low: { label: 'Lichess – bis 1400', db: 'lichess', ratings: [400, 1000, 1200] },
  mid: { label: 'Lichess – 1400 bis 1800', db: 'lichess', ratings: [1400, 1600] },
  high: { label: 'Lichess – 1800 bis 2200', db: 'lichess', ratings: [1800, 2000] },
  top: { label: 'Lichess – ab 2200', db: 'lichess', ratings: [2200, 2500] },
  masters: { label: 'Meisterpartien (Turnierschach)', db: 'masters' },
};

const EXPLORER = 'https://explorer.lichess.ovh';

async function explorerGet(path, token) {
  const res = await fetch(`${EXPLORER}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401) throw Object.assign(new Error('Anmeldung bei Lichess nötig.'), { auth: true });
  if (res.status === 429) throw new Error('Zu viele Anfragen – bitte kurz warten.');
  if (!res.ok) throw new Error(`Lichess-Datenbank antwortet mit Fehler ${res.status}.`);
  return res;
}

const gamesCache = new Map();

/** Bekannteste Meisterpartien mit dieser Stellung -> [{ id, winner, white: { name, rating }, black, year }] */
export async function masterGames(fen, token) {
  if (gamesCache.has(fen)) return gamesCache.get(fen);
  const q = new URLSearchParams({ fen, moves: '0', topGames: '12' });
  const data = await (await explorerGet(`masters?${q}`, token)).json();
  const games = data.topGames || [];
  gamesCache.set(fen, games);
  return games;
}

/** PGN einer Meisterpartie. */
export async function masterPgn(id, token) {
  return (await explorerGet(`masters/pgn/${encodeURIComponent(id)}`, token)).text();
}

const cache = new Map();

/** -> { white, draws, black, moves: [{ san, uci, white, draws, black, averageRating }], opening } */
export async function explore(fen, presetKey, token) {
  const key = `${presetKey}|${fen}`;
  if (cache.has(key)) return cache.get(key);
  const preset = PRESETS[presetKey] || PRESETS.all;
  const q = new URLSearchParams({ fen, moves: '12', topGames: '0', recentGames: '0' });
  if (preset.db === 'lichess') {
    q.set('variant', 'standard');
    q.set('speeds', 'blitz,rapid,classical');
    q.set('ratings', preset.ratings.join(','));
  }
  const data = await (await explorerGet(`${preset.db}?${q}`, token)).json();
  cache.set(key, data);
  return data;
}
