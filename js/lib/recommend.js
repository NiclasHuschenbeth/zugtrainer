// Repertoire-Empfehlung: Aus den eigenen Partien erkennen, in welcher Eröffnung es häufig schlecht läuft,
// und dazu den passenden Kurs nennen. Alles wird auf dem Gerät gerechnet; die Partien verlassen es nie.
//
// Zuordnung Partie -> Kurs über Stellungen (nicht über Namen): Die öffentliche Kursliste (catalog-data.js)
// enthält pro Kurs Kürzel der Stellungen aus dessen ersten Zügen. Gezählt wird, wie viele Halbzüge eine Partie
// in diesen Stellungen bleibt.
//   Weiß-Kurs:    passt, wenn der Nutzer den ersten Zug des Kurses spielt ("plays").
//   Schwarz-Kurs: passt am besten, wo die Partie dem Kurs am längsten folgt ("plays");
//                 spielt der Nutzer schon im ersten Zug etwas anderes, zählt die Partie nur als
//                 "Gegner hat diese Eröffnung gewählt" ("faces", Wechsel-Vorschlag).
// Empfohlen wird erst ab MIN_GAMES Partien und wenn das Ergebnis mindestens MIN_GAP unter der Erwartung liegt.
// Erwartung = was nach den Wertungszahlen der Gegner zu holen wäre (sonst: der eigene Schnitt mit dieser Farbe).
import { Chess } from 'chessops/chess.js';
import { makeFen } from 'chessops/fen.js';
import { parseSan } from 'chessops/san.js';
import { de, epdOf } from './repertoire.js';
import { outcomeFor } from './games.js';

export const MIN_GAMES = 10;
export const MIN_GAP = 0.05;
export const MAX_CARDS = 2;
const CLUB_RATING = 1800; // darunter werden Kurse "für Spieler bis ca. 1800" bevorzugt
const FACES_SKIP = new Set(['286399', '289014']); // Teil-Repertoires (Sizilianisch): kein Wechsel-Vorschlag

let catalogPromise = null;
/** Lädt die Kursliste erst bei Bedarf. */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = import('./catalog-data.js').then(m => ({
      maxPly: m.MAX_PLY,
      courses: m.COURSES.map((c, order) => ({ ...c, order, set: new Set(c.fp.split(' ')) })),
      bundles: m.BUNDLES,
    }));
  }
  return catalogPromise;
}

/** FNV-1a (32 Bit), gleiche Rechnung wie in tools/make_catalog.py. */
export function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const keyCache = new WeakMap();
/** Kürzel der Stellungen nach jedem der ersten maxPly Halbzüge einer Partie. */
function gameKeys(game, maxPly) {
  let keys = keyCache.get(game);
  if (keys) return keys;
  keys = [];
  const pos = Chess.default();
  for (let i = 0; i < Math.min(maxPly, game.moves.length); i++) {
    const move = parseSan(pos, game.moves[i]);
    if (!move) break;
    pos.play(move);
    keys.push(fnv(epdOf(makeFen(pos.toSetup()))));
  }
  keyCache.set(game, keys);
  return keys;
}

/** Zu welchen Kursen passt die Partie? -> { kind: 'plays' | 'faces', courses: [...] } | null */
export function matchGame(game, catalog) {
  const keys = gameKeys(game, catalog.maxPly);
  const depth = c => {
    let m = 0;
    while (m < keys.length && c.set.has(keys[m])) m++;
    return m;
  };
  // Nur Kurse, die mit diesem ersten Zug beginnen (seltene Zugumstellungen in einem Kurs zählen nicht)
  const cand = catalog.courses
    .filter(c => c.color === game.userColor && c.first.includes(game.moves[0]))
    .map(c => ({ c, m: depth(c) }))
    .filter(x => x.m >= 1);
  if (!cand.length) return null;
  if (game.userColor === 'white') return { kind: 'plays', courses: cand.map(x => x.c) };
  const best = Math.max(...cand.map(x => x.m));
  if (best >= 2) return { kind: 'plays', courses: cand.filter(x => x.m === best).map(x => x.c) };
  return { kind: 'faces', courses: cand.map(x => x.c).filter(c => !FACES_SKIP.has(c.id)) };
}

const ratingOf = (g, me) => (g.userColor === 'white') === me ? g.whiteElo : g.blackElo;
const median = list => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Ergebnis und Erwartung für eine Menge Partien. baseline = eigener Schnitt mit dieser Farbe (wenn Wertungen fehlen). */
function summarize(games, baseline) {
  const s = { n: games.length, w: 0, d: 0, l: 0 };
  let exp = 0;
  let rated = 0;
  for (const g of games) {
    s[outcomeFor(g)]++;
    const me = ratingOf(g, true);
    const opp = ratingOf(g, false);
    if (me && opp) {
      exp += 1 / (1 + 10 ** ((opp - me) / 400));
      rated++;
    }
  }
  s.score = s.n ? (s.w + s.d / 2) / s.n : 0;
  s.byRating = rated >= s.n / 2 && rated > 0;
  s.expected = s.byRating ? exp / rated : baseline;
  s.gap = s.expected - s.score;
  s.lost = s.gap * s.n; // verlorene Punkte gegenüber der Erwartung
  return s;
}

/** Häufigster Anfang (z. B. "1. e4 e5") der Partien, für den Begründungstext. */
function commonStart(games, plies) {
  const count = new Map();
  for (const g of games) {
    const k = g.moves.slice(0, plies).join(' ');
    count.set(k, (count.get(k) || 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return '';
  const [m1, m2] = top[0].split(' ');
  return de(m2 ? `1.${m1} ${m2}` : `1.${m1}`);
}

/**
 * Empfehlungen für eine Farbe.
 * owned: Set der Kurs-Kennungen, die der Nutzer schon hat (aus den Repertoires `course-<id>`); hidden: ausgeblendete Kurse.
 * -> [{ id, title, text, url, cover, kind, reason: {...}, ownedCourseId }]
 */
export function recommend(games, color, catalog, { owned = new Set(), hidden = {} } = {}) {
  const mine = games.filter(g => g.userColor === color);
  if (mine.length < MIN_GAMES) return [];
  const all = summarize(mine, 0.5);
  const baseline = all.score;
  const myRating = median(mine.map(g => ratingOf(g, true)).filter(Boolean));
  const prefer = myRating && myRating >= CLUB_RATING ? 'all' : 'club';

  // Partien je Kurs und Art sammeln
  const groups = new Map(); // "<kursId>|<art>" -> { course, kind, games }
  for (const g of mine) {
    const m = matchGame(g, catalog);
    if (!m) continue;
    for (const c of m.courses) {
      // Wechsel-Vorschläge getrennt nach dem ersten Zug des Gegners ("Gegen 1.d4 ...")
      const key = m.kind === 'faces' ? `${c.id}|faces|${g.moves[0]}` : `${c.id}|plays`;
      if (!groups.has(key)) groups.set(key, { course: c, kind: m.kind, games: [] });
      groups.get(key).games.push(g);
    }
  }
  const ownedCourse = c => c.courseIds.find(id => owned.has(id)) || null;
  const qualifies = s => s.n >= MIN_GAMES && s.gap >= MIN_GAP;

  let cands = [...groups.values()].map(gr => ({ ...gr, stats: summarize(gr.games, baseline) })).filter(x => qualifies(x.stats));

  // Paket statt Einzelkursen, wenn alle enthaltenen Kurse betroffen sind und der Nutzer noch keinen davon hat
  for (const b of catalog.bundles) {
    const parts = b.parts.map(id => groups.get(`${id}|plays`)).filter(Boolean);
    if (parts.length !== b.parts.length || parts.some(p => p.games.length < 3 || ownedCourse(p.course))) continue;
    const union = [...new Set(parts.flatMap(p => p.games))];
    const stats = summarize(union, baseline);
    if (!qualifies(stats)) continue;
    cands = cands.filter(x => !(x.kind === 'plays' && b.parts.includes(x.course.id)));
    cands.push({ course: { ...b, color, level: 'all', order: -1, courseIds: [] }, kind: 'plays', games: union, stats });
  }

  // Reihenfolge: "spielt die Eröffnung" vor Wechsel-Vorschlag, dann verlorene Punkte, passende Spielstärke, Kursliste
  const rank = x => [x.kind === 'plays' ? 0 : 1, -Math.round(x.stats.lost * 2), x.course.level === prefer ? 0 : 1, x.course.order];
  cands.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });

  // Auswahl: höchstens MAX_CARDS; keine zwei Karten, die sich überwiegend auf dieselben Partien stützen
  const out = [];
  const used = new Set();
  // Erste Gegnerzüge, zu denen schon eine Kurs-Karte ("plays") steht: dort keinen Wechsel-Vorschlag zusätzlich
  const covered = new Set();
  for (const x of cands) {
    if (hidden[x.course.id]) continue;
    const overlap = x.games.filter(g => used.has(g)).length;
    if (overlap > x.games.length / 2) continue;
    if (x.kind === 'faces' && covered.has(x.games[0].moves[0])) continue;
    x.games.forEach(g => used.add(g));
    if (x.kind === 'plays') x.games.forEach(g => covered.add(g.moves[0]));
    const s = x.stats;
    out.push({
      id: x.course.id,
      title: x.course.title,
      text: x.course.text,
      url: x.course.url,
      cover: x.course.cover,
      kind: x.kind,
      ownedCourseId: ownedCourse(x.course),
      reason: {
        n: s.n,
        w: s.w,
        d: s.d,
        l: s.l,
        score: s.score,
        expected: s.expected,
        byRating: s.byRating,
        color,
        played: x.course.played,
        start: commonStart(x.games, x.kind === 'faces' || color === 'white' ? 1 : 2),
      },
    });
    if (out.length >= MAX_CARDS) break;
  }
  return out;
}

/** Begründung in einem Satz, mit den eigenen Zahlen des Nutzers. */
export function reasonText(r) {
  const pct = x => `${Math.round(x * 100)} %`;
  const q = r.reason;
  const first =
    r.kind === 'faces'
      ? `Gegen ${q.start} hast du in ${q.n} Partien mit Schwarz ${pct(q.score)} der Punkte geholt.`
      : `Du hast in ${q.n} Partien ${q.played || `mit ${q.color === 'white' ? 'Weiß' : 'Schwarz'} ${q.start} gespielt`} und ${pct(q.score)} der Punkte geholt.`;
  const second = q.byRating
    ? `Nach der Stärke deiner Gegner wären ${pct(q.expected)} zu erwarten.`
    : `Dein Schnitt mit ${q.color === 'white' ? 'Weiß' : 'Schwarz'} liegt bei ${pct(q.expected)}.`;
  return `${first} ${second}`;
}
