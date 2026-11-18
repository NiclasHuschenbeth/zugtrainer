// Eröffnungen erkennen und auswerten (Namen: lichess-org/chess-openings, CC0).
import { outcomeFor } from './games.js';
import { OPENINGS_DE, SETUP_MOVES } from './openings-de.js';
import { de } from './repertoire.js';
import { variationDe } from './variations-de.js';

let table = null;
const famMoves = new Map(); // deutscher Familienname -> { moves, exact }
// Untervarianten nach ECO: pro Familie und ECO-Schlüssel nur ein klassischer Name.
// Die Lichess-Liste enthält sonst auch viele Spaß- und Kuriositätennamen.
const ecoCanon = new Map(); // "<deutscher Familienname>|<ECO>" -> { first } (englischer Name der Untervariante)
const NO_SUB = new Set(['Offen', 'Modern Variations', 'The Whale']); // zu allgemein: Partien zählen dann „ohne genauere Variante“
/** Lädt die Namenstabelle erst bei Bedarf. */
export async function loadOpenings() {
  if (!table) {
    const rows = (await import('./openings-data.js')).default;
    table = new Map(rows.map(([eco, name, moves]) => [moves, { eco, name }]));
    // Anfangszüge je (deutscher) Familie: der Eintrag mit genau dem Familiennamen, sonst der kürzeste
    for (const [, name, moves] of rows) {
      const fam = familyOf(name);
      const f = germanName(fam);
      if (!f) continue;
      const exact = name === fam;
      const old = famMoves.get(f);
      if (!old || (exact && !old.exact) || (exact === old.exact && moves.length < old.moves.length)) famMoves.set(f, { moves, exact });
    }
    for (const [f, moves] of Object.entries(SETUP_MOVES)) famMoves.set(f, { moves, exact: true });
    // Klassischer Name je ECO-Schlüssel: der erste Namensteil, der in diesem Schlüssel am häufigsten vorkommt
    // (die Hauptvariante hat viele Unterlinien, Kuriositäten meist nur eine); bei Gleichstand die kürzeste Zugfolge
    const count = new Map(); // key -> Map(first -> { n, moves })
    for (const [eco, name, moves] of rows) {
      if (!name.includes(':')) continue;
      const f = germanName(familyOf(name));
      if (!f) continue;
      const k = `${f}|${eco}`;
      const first = variationOf(name).split(',')[0].trim();
      let m = count.get(k);
      if (!m) count.set(k, (m = new Map()));
      const e = m.get(first) || { n: 0, moves };
      e.n++;
      if (moves.length < e.moves.length) e.moves = moves;
      m.set(first, e);
    }
    for (const [k, m] of count) {
      const [first] = [...m.entries()].sort((a, b) => b[1].n - a[1].n || a[1].moves.length - b[1].moves.length)[0];
      ecoCanon.set(k, { first });
    }
  }
  return table;
}

const MAX_PLIES = 14;
/** Tiefster passender Eintrag für den Anfang der Partie, dessen Familie einen eigenen Namen hat (sonst null). */
function lichessHit(game, map) {
  for (let n = Math.min(MAX_PLIES, game.moves.length); n >= 1; n--) {
    const hit = map.get(game.moves.slice(0, n).join(' '));
    if (hit && germanName(familyOf(hit.name))) return hit;
  }
  return null;
}

/** Züge einer Seite in den ersten n Halbzügen (ohne Schach-/Matt-Zeichen). */
const sideMoves = (game, white, n) => new Set(game.moves.slice(0, n).filter((_, i) => (i % 2 === 0) === white).map(s => s.replace(/[+#]/g, '')));

/**
 * Eröffnung einer Partie -> { family (deutsch), name (Lichess-Name für die Untervariante) } | null.
 * Zusätzlich zu den Lichess-Namen:
 * - Königsindischer Angriff: Weiß baut ♘f3, g3, ♗g2, d3 auf (ohne d4/c4). Lichess nennt schon 1.♘f3 d5 2.g3 so – das ist sonst Réti.
 * - Königsindisch / Grünfeld-Indisch: 1.d4 mit …♘f6 und …g6 ohne eigenen Namen: mit …d5 Grünfeld, mit …♗g7 Königsindisch.
 */
export function openingOf(game, map) {
  const hit = lichessHit(game, map);
  const family = hit ? germanName(familyOf(hit.name)) : null;
  const w = sideMoves(game, true, 20);
  if (['Nf3', 'g3', 'Bg2', 'd3'].every(m => w.has(m)) && !w.has('d4') && !w.has('c4')) {
    return { family: 'Königsindischer Angriff', name: 'Königsindischer Angriff' };
  }
  if (!hit || family === 'Königsindisch') {
    const b = sideMoves(game, false, 16);
    if (game.moves[0] === 'd4' && b.has('Nf6') && b.has('g6')) {
      if (b.has('d5')) return { family: 'Grünfeld-Indisch', name: 'Grünfeld-Indisch' };
      if (b.has('Bg7')) return { family: 'Königsindisch', name: hit && family === 'Königsindisch' ? hit.name : 'Königsindisch' };
    }
  }
  return hit ? { family, name: hit.name, eco: hit.eco } : null;
}

/** Untervariante einer erkannten Eröffnung: klassischer ECO-Name, nur der erste Teil, auf Deutsch ('' = keine genauere). */
export function subOf(op) {
  if (!op.eco) return '';
  const canon = ecoCanon.get(`${op.family}|${op.eco}`);
  const label = canon ? variationDe(canon.first) : '';
  return NO_SUB.has(label) ? '' : label;
}

const DE = {
  'Sicilian Defense': 'Sizilianisch',
  'French Defense': 'Französisch',
  'Caro-Kann Defense': 'Caro-Kann',
  'Italian Game': 'Italienisch',
  'Ruy Lopez': 'Spanisch (Ruy Lopez)',
  "Queen's Gambit Declined": 'Damengambit abgelehnt',
  "Queen's Gambit Accepted": 'Damengambit angenommen',
  "Queen's Gambit": 'Damengambit',
  "King's Indian Defense": 'Königsindisch',
  "King's Indian Attack": 'Königsindischer Angriff',
  "Queen's Pawn Game": 'Damenbauernspiel',
  "Queen's Pawn Opening": 'Damenbauernspiel',
  "King's Pawn Game": 'Königsbauernspiel',
  'English Opening': 'Englisch',
  'Scandinavian Defense': 'Skandinavisch',
  'Pirc Defense': 'Pirc',
  'Slav Defense': 'Slawisch',
  'Semi-Slav Defense': 'Semi-Slawisch',
  'Nimzo-Indian Defense': 'Nimzo-Indisch',
  "Queen's Indian Defense": 'Damenindisch',
  'London System': 'London-System',
  'Vienna Game': 'Wiener Partie',
  'Scotch Game': 'Schottisch',
  'Four Knights Game': 'Vierspringerspiel',
  'Three Knights Opening': 'Dreispringerspiel',
  'Russian Game': 'Russisch (Petrow)',
  "Petrov's Defense": 'Russisch (Petrow)',
  'Philidor Defense': 'Philidor',
  "Alekhine's Defense": 'Aljechin',
  'Dutch Defense': 'Holländisch',
  "Bishop's Opening": 'Läuferspiel',
  "King's Gambit": 'Königsgambit',
  "King's Gambit Accepted": 'Königsgambit angenommen',
  "King's Gambit Declined": 'Königsgambit abgelehnt',
  'Grünfeld Defense': 'Grünfeld-Indisch',
  'Catalan Opening': 'Katalanisch',
  'Modern Defense': 'Modern',
  'Zukertort Opening': 'Zukertort',
  'Réti Opening': 'Réti',
  'Bird Opening': 'Bird',
  'Polish Opening': 'Polnisch',
  'Benoni Defense': 'Benoni',
  'Benko Gambit': 'Wolga-Gambit',
  'Trompowsky Attack': 'Trompowsky',
  'Danish Gambit': 'Dänisches Gambit',
  'Evans Gambit': 'Evans-Gambit',
  'Latvian Gambit': 'Lettisches Gambit',
  'Center Game': 'Mittelgambit',
  'Ponziani Opening': 'Ponziani',
  'Englund Gambit': 'Englund-Gambit',
  'Budapest Defense': 'Budapester Gambit',
  'Old Indian Defense': 'Altindisch',
  'Indian Defense': 'Indische Verteidigung',
  'Hungarian Opening': 'Ungarisch',
  'Owen Defense': 'Owen',
  'Portuguese Opening': 'Portugiesisch',
  'Nimzowitsch Defense': 'Nimzowitsch-Verteidigung',
  'Elephant Gambit': 'Elefantengambit',
  'Blackmar-Diemer Gambit': 'Blackmar-Diemer-Gambit',
  'Colle System': 'Colle-System',
  'Torre Attack': 'Torre-Angriff',
};

export const familyOf = name => name.split(':')[0];
/** Deutscher Name einer Familie; null = nicht eigens benennen. Schon deutsche Namen bleiben, wie sie sind. */
export const germanName = name => (name in OPENINGS_DE ? OPENINGS_DE[name] : DE[name] || name);
/** Anfangszüge einer Eröffnungsfamilie zum Anzeigen ("1.e4 e5 2.♘f3 ♘f6"), sonst ''. */
export function openingMoves(family) {
  const m = famMoves.get(family);
  if (!m) return '';
  return m.moves
    .split(' ')
    .map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${de(s)}` : de(s)))
    .join(' ');
}
export const variationOf = name => (name.includes(':') ? name.slice(name.indexOf(':') + 1).trim() : null);

/** Auswertung pro Eröffnungsfamilie für die Partien einer Farbe. */
export function openingStats(games, map) {
  const fam = new Map();
  let unknown = 0;
  const add = (o, g) => {
    o.n++;
    o[outcomeFor(g)]++;
  };
  for (const g of games) {
    const op = openingOf(g, map);
    if (!op) {
      unknown++;
      continue;
    }
    const f = op.family;
    let e = fam.get(f);
    if (!e) fam.set(f, (e = { name: f, n: 0, w: 0, d: 0, l: 0, vars: new Map() }));
    add(e, g);
    // Untervarianten auf Deutsch; gleich lautende (z. B. angenommen/abgelehnt) zusammen
    const label = subOf(op);
    let v = e.vars.get(label);
    if (!v) e.vars.set(label, (v = { name: op.name, label, n: 0, w: 0, d: 0, l: 0 }));
    add(v, g);
  }
  const list = [...fam.values()].map(e => ({
    ...e,
    score: (e.w + e.d / 2) / e.n,
    vars: [...e.vars.values()].map(v => ({ ...v, score: (v.w + v.d / 2) / v.n })).sort((a, b) => b.n - a.n),
  }));
  list.sort((a, b) => b.n - a.n);
  return { list, unknown, total: games.length };
}
