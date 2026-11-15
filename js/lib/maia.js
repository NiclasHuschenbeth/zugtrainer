// Maia-3: ein neuronales Netz, das Züge so wählt, wie Menschen einer bestimmten Spielstärke sie spielen.
// Läuft komplett im Browser (onnxruntime-web, WebAssembly). Modell und Rechenprogramm (zusammen ca. 22 MB)
// werden erst beim ersten Gebrauch geladen und danach vom Service Worker offline bereitgehalten.
// Modell: Maia3-5M (CSSLab, University of Toronto, AGPL-3.0), siehe vendor/maia/README.txt.
// Eingabe und Zugliste folgen dem offiziellen Quellcode (github.com/CSSLab/maia3: dataset.py, utils.py):
//   - Das Brett wird immer aus Sicht der Seite am Zug gezeigt (bei Schwarz am Zug gespiegelt, Farben getauscht).
//   - 64 Felder x 12 Kanäle: eigene B, S, L, T, D, K, dann die gegnerischen.
//   - Zugliste: 64 x 64 Paare (von, nach) + 256 Umwandlungen (Linie von, Linie nach, D/T/L/S) = 4352 Einträge.
import { posFromFen } from './repertoire.js';

export const MAIA_LEVELS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400];
export const MAIA_DEFAULT = 1600;

const ROLE = { pawn: 0, knight: 1, bishop: 2, rook: 3, queen: 4, king: 5 };
const PROMO = ['queen', 'rook', 'bishop', 'knight'];
const base = new URL('../../vendor/', import.meta.url).href;

let sessionPromise = null;

/** Lädt Rechenprogramm und Modell (einmal). Bei einem Fehler darf später erneut versucht werden. */
export function loadMaia() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import(base + 'ort/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = base + 'ort/';
      ort.env.wasm.numThreads = 1; // mehrere Threads bräuchten besondere Server-Kopfzeilen; ein Thread reicht (ein Zug < 0,3 s)
      const res = await fetch(base + 'maia/maia3-5m.fp16.onnx');
      if (!res.ok) throw new Error('Maia-Modell nicht erreichbar');
      const model = await res.arrayBuffer();
      // 'basic': höhere Optimierungsstufen haben bei diesem Modell (halbe Genauigkeit) einen bekannten Fehler
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' });
      return { ort, session };
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/** Brett als Eingabe für das Netz und alle erlaubten Züge mit ihrer Stelle in der Zugliste. */
export function encode(fen) {
  const pos = posFromFen(fen);
  const flip = pos.turn === 'black' ? 56 : 0; // Reihen spiegeln
  const tokens = new Float32Array(64 * 12);
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board.get(sq);
    if (p) tokens[(sq ^ flip) * 12 + ROLE[p.role] + (p.color === pos.turn ? 0 : 6)] = 1;
  }
  const legal = []; // { index, move }
  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    for (const to of dests) {
      const target = pos.board.get(to);
      if (piece.role === 'king' && target && target.color === pos.turn && target.role === 'rook') {
        // Rochade: hier als "König schlägt Turm" geführt, in der Zugliste als Königszug nach g bzw. c
        const kingTo = (from & 56) | (to > from ? 6 : 2);
        legal.push({ index: (from ^ flip) * 64 + (kingTo ^ flip), move: { from, to } });
      } else if (piece.role === 'pawn' && (to >> 3 === 0 || to >> 3 === 7)) {
        PROMO.forEach((promotion, k) => legal.push({ index: 4096 + ((from & 7) * 8 + (to & 7)) * 4 + k, move: { from, to, promotion } }));
      } else {
        legal.push({ index: (from ^ flip) * 64 + (to ^ flip), move: { from, to } });
      }
    }
  }
  return { tokens, legal };
}

/** Wahrscheinlichkeit jedes erlaubten Zugs für einen Spieler der Stärke `elo`. -> [{ move, p }] absteigend */
export async function maiaMoves(fen, elo = MAIA_DEFAULT, oppElo = elo) {
  const { ort, session } = await loadMaia();
  const { tokens, legal } = encode(fen);
  if (!legal.length) return [];
  const feeds = {};
  for (const name of session.inputNames) {
    if (name === 'tokens') feeds[name] = new ort.Tensor('float32', tokens, [1, 64, 12]);
    else feeds[name] = new ort.Tensor('float32', new Float32Array([/oppo/.test(name) ? oppElo : elo]), [1]);
  }
  const out = await session.run(feeds);
  const logits = out.logits_move.data;
  const max = Math.max(...legal.map(l => logits[l.index]));
  const weights = legal.map(l => Math.exp(logits[l.index] - max));
  const sum = weights.reduce((a, b) => a + b, 0);
  return legal.map((l, i) => ({ move: l.move, p: weights[i] / sum })).sort((a, b) => b.p - a.p);
}

/** Zieht einen Zug nach seiner Wahrscheinlichkeit (so wie ein Mensch dieser Stärke ziehen würde). -> { move, p } | null */
export async function maiaPick(fen, elo = MAIA_DEFAULT) {
  const list = await maiaMoves(fen, elo);
  if (!list.length) return null;
  let x = Math.random();
  return list.find(m => (x -= m.p) < 0) || list[0];
}
