// Eröffnungen erkennen und auswerten (Namen: lichess-org/chess-openings, CC0).
import { outcomeFor } from './games.js';

let table = null;
/** Lädt die Namenstabelle erst bei Bedarf. */
export async function loadOpenings() {
  if (!table) {
    const rows = (await import('./openings-data.js')).default;
    table = new Map(rows.map(([eco, name, moves]) => [moves, { eco, name }]));
  }
  return table;
}

const MAX_PLIES = 14;
/** Tiefster passender Eintrag für den Anfang der Partie (sonst null). */
export function openingOf(game, map) {
  for (let n = Math.min(MAX_PLIES, game.moves.length); n >= 1; n--) {
    const hit = map.get(game.moves.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return null;
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
export const germanName = name => DE[name] || name;
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
    const f = familyOf(op.name);
    let e = fam.get(f);
    if (!e) fam.set(f, (e = { name: f, n: 0, w: 0, d: 0, l: 0, vars: new Map() }));
    add(e, g);
    let v = e.vars.get(op.name);
    if (!v) e.vars.set(op.name, (v = { name: op.name, n: 0, w: 0, d: 0, l: 0 }));
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
