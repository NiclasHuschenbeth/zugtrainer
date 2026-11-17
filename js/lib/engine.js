// Stockfish 19 (Lite) als Web Worker. Spricht UCI.
// Mehrere Kerne gehen nur, wenn die Seite "cross-origin isolated" ist (besondere Kopfzeilen in _headers);
// sonst läuft die Ein-Kern-Fassung wie bisher.
const SINGLE_URL = new URL('../../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url);
const MULTI_URL = new URL('../../vendor/stockfish/stockfish-19-lite.js', import.meta.url);

/** Obergrenze für Kerne. Der Browser gibt Stockfish höchstens 2 GB Speicher; mehr Kerne bringen jeweils etwas weniger. */
export const MAX_THREADS = 32;

const phone = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Wie viele Kerne Stockfish hier nutzen darf (1 = Ein-Kern-Fassung). */
export function engineThreads() {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency || 2;
  // einen Kern für die Seite selbst freilassen
  return Math.max(1, Math.min(MAX_THREADS, cores - 1));
}

export class StockfishEngine {
  /** onUpdate({ fen, depth, lines: [{ cp?, mate?, pv: [uci] }] }) – Bewertung aus Sicht von Weiß */
  constructor(onUpdate, { multiPv = 3, depth, threads = engineThreads(), hash } = {}) {
    this.onUpdate = onUpdate;
    // Handy: etwas weniger tief und weniger Speicher, damit der Akku hält
    this.depth = depth || (phone() ? 26 : 30);
    this.threads = threads;
    this.searching = false;
    this.pending = null;
    this.fen = null;
    this.lines = [];
    this.worker = new Worker(threads > 1 ? MULTI_URL : SINGLE_URL);
    this.worker.onmessage = e => this.receive(typeof e.data === 'string' ? e.data : '');
    this.send('uci');
    if (threads > 1) this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${hash || (phone() ? 32 : threads > 8 ? 256 : 64)}`);
    this.send(`setoption name MultiPV value ${multiPv}`);
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  analyse(fen) {
    this.pending = fen;
    if (this.searching) this.send('stop');
    else this.startPending();
  }

  startPending() {
    this.fen = this.pending;
    this.pending = null;
    this.lines = [];
    this.searching = true;
    this.send(`position fen ${this.fen}`);
    this.send(`go depth ${this.depth}`);
  }

  receive(line) {
    if (line.startsWith('bestmove')) {
      this.searching = false;
      if (this.pending) this.startPending();
      return;
    }
    if (!line.startsWith('info') || this.pending || !this.fen) return;
    const pv = line.match(/ pv (.+)$/);
    const score = line.match(/score (cp|mate) (-?\d+)/);
    if (!pv || !score || / (upper|lower)bound/.test(line)) return;
    const depth = +(line.match(/ depth (\d+)/) || [0, 0])[1];
    const idx = +(line.match(/ multipv (\d+)/) || [0, 1])[1] - 1;
    const sign = this.fen.split(' ')[1] === 'w' ? 1 : -1;
    const entry = { pv: pv[1].trim().split(' '), depth };
    entry[score[1]] = sign * +score[2];
    this.lines[idx] = entry;
    this.onUpdate({ fen: this.fen, depth, lines: this.lines.filter(Boolean) });
  }

  destroy() {
    this.worker.terminate();
  }
}

export function formatScore(l) {
  if (l.mate != null) return `#${l.mate}`;
  const v = l.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
