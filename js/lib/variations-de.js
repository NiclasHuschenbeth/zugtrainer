// Untervarianten (Lichess-Namen, englisch) automatisch auf Deutsch: Fachwörter übersetzen, Eigennamen bleiben.
// Beispiele: "Najdorf Variation" -> "Najdorf-Variante", "Exchange Variation" -> "Abtausch-Variante",
// "Classical Variation" -> "Klassische Variante", "Smith-Morra Gambit Accepted" -> "Smith-Morra-Gambit".
// Einzelne Namen lassen sich in FIXED von Hand festlegen (geht vor).
import { de } from './repertoire.js';

/** Von Hand festgelegte Übersetzungen ganzer Abschnitte (nach Durchsicht durch Niclas ergänzen). */
const FIXED = {
  'Main Line': 'Hauptvariante',
  Closed: 'Geschlossen',
  Open: 'Offen',
  Fianchetto: 'Fianchetto',
  'Kingside Fianchetto': 'Fianchetto am Königsflügel',
  'Double Fianchetto': 'Doppelfianchetto',
  Sicilian: 'Sizilianisch',
  'Two Knights': 'Zweispringer',
  'Three Knights': 'Dreispringer',
  'Four Knights': 'Vierspringer',
  'Accelerated Dragon': 'Beschleunigter Drache',
  'Hyperaccelerated Dragon': 'Hyperbeschleunigter Drache',
  'Poisoned Pawn Variation': 'Variante mit vergiftetem Bauern',
  'Three Knights Game': 'Dreispringerspiel',
  "King's English": 'Königsenglisch',
  "King's English Variation": 'Königsenglisch-Variante',
  "King's Indian Attack": 'Königsindischer Angriff',
  "King's Indian System": 'Königsindisches System',
  'Pawn Storm Variation': 'Bauernsturm-Variante',
  'Old Sicilian': 'Alt-Sizilianisch',
  'Retreat Variation': 'Rückzugs-Variante',
  'Central Countergambit': 'Zentrums-Gegengambit',
  'Central Variation': 'Zentrums-Variante',
  'Moscow Variation': 'Moskauer Variante',
  'Nyezhmetdinov-Rossolimo Attack': 'Rossolimo-Variante',
  'Brussels Gambit': 'Brüsseler Gambit',
  'Scandinavian Variation': 'Skandinavische Variante',
  'Semi-Slav': 'Halbslawisch',
  'Baltic Defense': 'Baltische Verteidigung',
  'Finnish Variation': 'Finnische Variante',
  'Anglo-Scandinavian Defense': 'Anglo-Skandinavisch',
  'Anglo-Indian Defense': 'Anglo-Indisch',
  'Mikenas-Carls': 'Mikenas-Carls-Variante',
  'Caro-Kann Defensive System': 'Caro-Kann-Aufbau',
  Classical: 'Klassisch',
  Exchange: 'Abtausch',
  Advance: 'Vorstoß',
};

// Hauptwörter am Ende: deutsches Wort und Geschlecht (für die Endung eines Adjektivs davor)
const NOUNS = {
  Variation: ['Variante', 'f'],
  Line: ['Variante', 'f'],
  Defense: ['Verteidigung', 'f'],
  Attack: ['Angriff', 'm'],
  Counterattack: ['Gegenangriff', 'm'],
  Gambit: ['Gambit', 'n'],
  Countergambit: ['Gegengambit', 'n'],
  System: ['System', 'n'],
  Formation: ['Aufbau', 'm'],
  Opening: ['Eröffnung', 'f'],
  Trap: ['Falle', 'f'],
  Plan: ['Plan', 'm'],
};

// Adjektive (Stamm): bekommen die Endung passend zum Hauptwort, kein Bindestrich
const ADJ = {
  Classical: 'klassisch', Modern: 'modern', Closed: 'geschlossen', Open: 'offen', Normal: 'normal', Symmetrical: 'symmetrisch',
  Accelerated: 'beschleunigt', Old: 'alt', New: 'neu', Central: 'zentral', Positional: 'positionell', Quiet: 'ruhig',
  English: 'englisch', French: 'französisch', Spanish: 'spanisch', Italian: 'italienisch', Russian: 'russisch', Hungarian: 'ungarisch',
  Polish: 'polnisch', Dutch: 'holländisch', Czech: 'tschechisch', Swiss: 'Schweizer', Scotch: 'schottisch', Danish: 'nordisch',
  Swedish: 'schwedisch', Norwegian: 'norwegisch', Yugoslav: 'jugoslawisch', Belgrade: 'Belgrader', Austrian: 'österreichisch',
  Reversed: 'umgekehrt', Delayed: 'verzögert', Early: 'früh', Romantic: 'romantisch',
};

// Hauptwort-artige Bestimmungswörter: werden mit Bindestrich vorangestellt ("Abtausch-Variante")
const PREFIX = {
  Exchange: 'Abtausch', Advance: 'Vorstoß', Dragon: 'Drachen', Hedgehog: 'Igel', Fianchetto: 'Fianchetto', Wing: 'Flügel',
  Knight: 'Springer', Bishop: 'Läufer', Rook: 'Turm', Queen: 'Damen', King: 'Königs', Pawn: 'Bauern', Center: 'Zentrums',
  Mainline: 'Haupt', Anti: 'Anti',
};

const ENDINGS = { f: 'e', m: 'er', n: 'es' };

function word(w) {
  return w
    .replace(/^King's$/, 'Königs')
    .replace(/^Queen's$/, 'Damen')
    .replace(/^Two$/, 'Zwei')
    .replace(/^Three$/, 'Drei')
    .replace(/^Four$/, 'Vier')
    .replace(/^Knights$/, 'springer')
    .replace(/^Pawns$/, 'bauern');
}

/** "Königs" + "Springer" -> "Königsspringer", "Zwei" + "bauern" -> "Zweibauern" (zusammengeschrieben). */
function merge(list) {
  const parts = [];
  for (const w of list) {
    const prev = parts[parts.length - 1];
    if (prev && /^(Königs|Damen|Zwei|Drei|Vier)$/.test(prev)) parts[parts.length - 1] = prev + w.toLowerCase();
    else parts.push(w);
  }
  return parts;
}

/** Ein Abschnitt (zwischen Kommas), z. B. "Najdorf Variation" oder "with Bf5". */
function segment(seg) {
  let s = seg.trim();
  if (FIXED[s]) return FIXED[s];
  // Gambits: ob angenommen oder abgelehnt, steht nicht dabei (wie bei den Eröffnungen)
  s = s.replace(/\s+(Accepted|Declined|Deferred)$/, '');
  if (FIXED[s]) return FIXED[s];
  const m = /^with (?:\.\. ?)?(.+)$/.exec(s);
  if (m) return `mit ${s.includes('..') ? '…' : ''}${de(m[1])}`;
  const words = s.split(/\s+/);
  const last = words[words.length - 1];
  const noun = NOUNS[last];
  if (!noun) return merge(words.map(word).map(x => PREFIX[x] || x)).join(' ');
  const [nounDe, gender] = noun;
  const rest = words.slice(0, -1).map(word);
  if (!rest.length) return nounDe;
  if (rest.length === 1 && rest[0] === 'Main' && nounDe === 'Variante') return 'Hauptvariante';
  // Adjektive vorne ("Klassische Variante"), Eigennamen/Bestimmungswörter mit Bindestrich ("Najdorf-Variante")
  const adj = [];
  while (rest.length && ADJ[rest[0]]) {
    const a = ADJ[rest.shift()];
    adj.push(a === 'Schweizer' || a === 'Belgrader' ? a : a.charAt(0).toUpperCase() + a.slice(1) + ENDINGS[gender]);
  }
  const head = merge(rest.map(x => PREFIX[x] || x)).join('-');
  const compound = head ? `${head}-${nounDe}` : nounDe;
  return [...adj, compound].join(' ');
}

const cache = new Map();
/** "Najdorf Variation, English Attack" -> "Najdorf-Variante, Englischer Angriff" */
export function variationDe(name) {
  if (!name) return name;
  if (cache.has(name)) return cache.get(name);
  const out = name
    .split(',')
    .map(segment)
    .filter(Boolean)
    .join(', ');
  cache.set(name, out);
  return out;
}
