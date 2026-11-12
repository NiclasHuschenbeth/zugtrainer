// Stockfish 19 (Lite, ein Thread) als Web Worker. Spricht UCI.
const WORKER_URL = new URL('../../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url);

export class StockfishEngine {
  /** onUpdate({ fen, depth, lines: [{ cp?, mate?, pv: [uci] }] }) – Bewertung aus Sicht von Weiß */
  constructor(onUpdate, { multiPv = 3, depth = 24 } = {}) {
    this.onUpdate = onUpdate;
    this.depth = depth;
    this.searching = false;
    this.pending = null;
    this.fen = null;
    this.lines = [];
    this.worker = new Worker(WORKER_URL);
    this.worker.onmessage = e => this.receive(typeof e.data === 'string' ? e.data : '');
    this.send('uci');
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
