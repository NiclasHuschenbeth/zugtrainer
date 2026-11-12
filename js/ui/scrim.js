// Testpartie: das Repertoire gegen Gegnerzüge spielen, die nach echter Häufigkeit gezogen werden.
// Verlässt die Partie die Vorbereitung, folgen ein paar freie Züge, dann bewertet Stockfish die Stellung.
import { html, useEffect, useReducer, useRef } from 'preact';
import { de } from '../lib/repertoire.js';
import { chessgroundDests } from 'chessops/compat.js';
import { makeFen } from 'chessops/fen.js';
import { makeSanAndPlay, parseSan } from 'chessops/san.js';
import { parseSquare, parseUci } from 'chessops/util.js';
import { derived, epdOf, moveKeys, moveLabel, posFromFen, turnOf } from '../lib/repertoire.js';
import { StockfishEngine, formatScore } from '../lib/engine.js';
import { PRESETS, explore, startLogin } from '../lib/lichess.js';
import { locate } from '../lib/coverage.js';
import { sounds } from '../lib/sound.js';
import { Board } from './board.js';

const FREE_MOVES = 3;
const DEPTH = 14;
const VERDICT = {
  won: { label: 'Gewonnen', cls: 'ok' },
  held: { label: 'Gehalten', cls: 'ask' },
  lost: { label: 'Verloren', cls: 'bad' },
};

/** Stockfish für einzelne Abfragen: eval(fen) -> beste Linie (Bewertung aus Sicht von Weiß). */
function makeJudge() {
  let want = null;
  const finish = () => {
    const w = want;
    want = null;
    clearTimeout(w.t);
    w.resolve(w.last);
  };
  const eng = new StockfishEngine(
    info => {
      if (!want || info.fen !== want.fen) return;
      want.last = info.lines;
      if (info.depth >= DEPTH) finish();
    },
    { multiPv: 3, depth: DEPTH },
  );
  return {
    eval: fen =>
      new Promise(resolve => {
        if (want) finish();
        want = { fen, resolve, last: null };
        want.t = setTimeout(() => want && want.fen === fen && finish(), 12000);
        eng.analyse(fen);
      }),
    destroy: () => eng.destroy(),
  };
}

class Game {
  constructor(rep, opts, onChange, onGrade) {
    this.rep = rep;
    this.opts = opts; // () => ({ preset, token, sound })
    this.onChange = onChange;
    this.onGrade = onGrade;
    this.index = derived(rep).index;
    this.judge = makeJudge();
    this.tally = { won: 0, held: 0, lost: 0 };
    this.cg = null;
    this.run = 0;
    this.start();
  }

  start() {
    const starts = [...new Set(this.rep.chapters.map(c => c.startFen))];
    this.run++;
    this.fen = starts[Math.floor(Math.random() * starts.length)];
    this.startFen = this.fen;
    this.last = undefined;
    this.moves = [];
    this.phase = 'prep'; // prep | free | judging | done
    this.freeLeft = 0;
    this.left = null; // wo die Vorbereitung endete
    this.result = null;
    this.arrow = null;
    this.thinking = false;
    this.sync();
    this.step();
  }

  mine() {
    return turnOf(this.fen) === this.rep.color;
  }

  sync() {
    if (this.cg) {
      const pos = posFromFen(this.fen);
      const canMove = (this.phase === 'prep' || this.phase === 'free') && this.mine() && !this.thinking;
      this.cg.set({
        fen: this.fen,
        turnColor: turnOf(this.fen),
        lastMove: this.last,
        check: pos.isCheck(),
        movable: { color: canMove ? this.rep.color : undefined, dests: canMove ? chessgroundDests(pos) : new Map() },
      });
      this.cg.setAutoShapes(this.arrow ? [this.arrow] : []);
    }
    this.onChange();
  }

  apply(move) {
    const pos = posFromFen(this.fen);
    const label = moveLabel(this.fen);
    this.last = moveKeys(pos, move);
    const san = makeSanAndPlay(pos, move);
    this.moves.push(label.endsWith('.') || !this.moves.length ? `${label} ${san}` : san);
    this.fen = makeFen(pos.toSetup());
    return san;
  }

  /** Nach jedem Zug: wer ist dran, sind wir noch in der Vorbereitung? */
  step() {
    if (posFromFen(this.fen).isEnd()) return this.finish();
    if (this.mine()) {
      if (this.phase === 'free' && this.freeLeft <= 0) return this.finish();
      return this.sync();
    }
    if (this.phase === 'free' && this.freeLeft <= 0) return this.finish();
    this.opponent();
  }

  leave(left) {
    this.phase = 'free';
    this.freeLeft = FREE_MOVES;
    this.left = left;
  }

  async opponent() {
    const run = this.run;
    const fen = this.fen;
    this.thinking = true;
    this.sync();
    const { preset, token } = this.opts();
    let pick = null;
    try {
      if (preset === 'sf') throw new Error('Stockfish als Gegner');
      const data = await explore(fen, preset, token);
      const total = data.white + data.draws + data.black;
      if (total >= 20 && data.moves.length) {
        const list = data.moves.map(m => ({ san: m.san, n: m.white + m.draws + m.black }));
        let x = Math.random() * list.reduce((s, m) => s + m.n, 0);
        const m = list.find(m => (x -= m.n) < 0) || list[0];
        const move = parseSan(posFromFen(fen), m.san);
        if (move) pick = { move, share: m.n / total };
      }
    } catch (err) {
      if (err.auth) {
        if (run === this.run) this.onAuth && this.onAuth();
        return;
      }
    }
    if (!pick) {
      // keine Partien mehr in der Datenbank: Stockfish spielt weiter
      // Etwas Abwechslung: zufällig einer der Züge, die höchstens 0,3 schlechter sind als der beste.
      const lines = (await this.judge.eval(fen)) || [];
      const sign = turnOf(fen) === 'white' ? 1 : -1;
      const val = l => sign * (l.mate != null ? Math.sign(l.mate) * 100000 : l.cp);
      const good = lines.filter(l => val(l) >= val(lines[0]) - 30);
      const line = good[Math.floor(Math.random() * good.length)];
      const move = line && parseUci(line.pv[0]);
      if (move && posFromFen(fen).isLegal(move)) pick = { move, share: null };
    }
    await new Promise(r => setTimeout(r, 350));
    if (run !== this.run) return;
    this.thinking = false;
    if (!pick) return this.finish();

    const known = this.index.get(epdOf(fen));
    const san = this.apply(pick.move);
    if (this.phase === 'prep') {
      if (!known) this.leave({ type: 'end', fen });
      else if (!known.has(san)) this.leave({ type: 'gap', fen, san: `${moveLabel(fen)} ${san}`, share: pick.share });
    }
    this.step();
  }

  userMove(orig, dest) {
    const pos = posFromFen(this.fen);
    const move = { from: parseSquare(orig), to: parseSquare(dest) };
    const piece = pos.board.get(move.from);
    if (piece && piece.role === 'pawn' && (move.to >> 3 === 0 || move.to >> 3 === 7)) move.promotion = 'queen';
    if (!pos.isLegal(move)) return this.sync();
    const fen = this.fen;

    if (this.phase === 'prep') {
      const known = this.index.get(epdOf(fen));
      if (!known) {
        // eigene Linie endet auf einem Gegnerzug: ab hier frei
        this.leave({ type: 'end', fen });
      } else {
        const san = makeSanAndPlay(pos.clone(), move);
        if (!known.has(san)) {
          const [right, keys] = known.entries().next().value;
          this.onGrade(`${epdOf(fen)}|${right}`, false);
          this.arrow = { orig: keys.from, dest: keys.to, brush: 'green' };
          this.left = { type: 'forgot', fen, played: `${moveLabel(fen)} ${san}`, right: `${moveLabel(fen)} ${right}` };
          if (this.opts().sound) sounds.bad();
          return this.end('lost', null);
        }
        if (this.opts().sound) sounds.ok();
      }
    }
    if (this.phase === 'free') this.freeLeft--;
    this.apply(move);
    this.step();
  }

  async finish() {
    const run = this.run;
    this.phase = 'judging';
    this.thinking = false;
    this.sync();
    const pos = posFromFen(this.fen);
    const side = this.rep.color === 'white' ? 1 : -1;
    let score; // aus meiner Sicht, in Bauerneinheiten * 100
    let text;
    if (pos.isCheckmate()) {
      score = this.mine() ? -100000 : 100000;
      text = 'Matt';
    } else if (pos.isEnd()) {
      score = 0;
      text = 'Remis';
    } else {
      const line = ((await this.judge.eval(this.fen)) || [])[0];
      if (run !== this.run) return;
      if (!line) {
        score = 0;
        text = '?';
      } else {
        score = side * (line.mate != null ? Math.sign(line.mate) * 100000 : line.cp);
        text = formatScore(line);
      }
    }
    this.end(score >= -50 ? 'won' : score >= -150 ? 'held' : 'lost', text);
  }

  end(verdict, evalText) {
    this.phase = 'done';
    this.result = { verdict, evalText };
    this.tally[verdict]++;
    if (verdict !== 'lost' && this.opts().sound) sounds.done();
    this.sync();
  }

  destroy() {
    this.run++;
    this.judge.destroy();
  }
}

export function Scrim({ rep, settings, setSettings, onGrade, onExit, onEdit }) {
  const [, force] = useReducer(x => x + 1, 0);
  const token = settings.lichessToken;
  const optsRef = useRef(null);
  const opp = settings.opponent || (token ? settings.explorer : 'sf');
  const needLogin = opp !== 'sf' && !token;
  optsRef.current = { preset: opp, token, sound: settings.sound };
  const gradeRef = useRef(onGrade);
  gradeRef.current = onGrade;
  const game = useRef(null);
  const cg = useRef(null);

  useEffect(() => {
    if (needLogin) return;
    const g = new Game(rep, () => optsRef.current, force, (k, ok) => gradeRef.current(k, ok));
    g.onAuth = () => setSettings({ lichessToken: null });
    if (cg.current) cg.current.set({ orientation: rep.color });
    g.cg = cg.current;
    game.current = g;
    g.sync();
    return () => {
      g.destroy();
      game.current = null;
    };
  }, [needLogin]);

  if (needLogin) {
    return html`<div class="card">
      <h2>Testpartie: ${rep.name}</h2>
      <p class="muted">In der Testpartie spielst du dein Repertoire gegen Züge, die echte Gegner auf Lichess in der jeweiligen Stellung spielen. Dafür braucht der Zugtrainer die Lichess-Partiendatenbank, und die gibt Lichess nur für angemeldete Nutzer frei. Der Zugtrainer erhält dabei keine Rechte auf deinem Konto.</p>
      <div class="row">
        <button class="btn primary" onClick=${() => startLogin({ name: 'scrim', repId: rep.id })}>Mit Lichess anmelden</button>
        <button class="btn" onClick=${() => setSettings({ opponent: 'sf' })}>Stattdessen gegen Stockfish spielen</button>
        <button class="btn ghost" onClick=${onExit}>Zurück</button>
      </div>
    </div>`;
  }

  const g = game.current;
  const r = g && g.result;
  const left = g && g.left;
  const where = left && locate(rep, left.fen);

  let status;
  if (!g) status = html`<div class="msg idle">Lade …</div>`;
  else if (g.phase === 'judging') status = html`<div class="msg info">Stockfish bewertet die Stellung …</div>`;
  else if (g.phase === 'done') {
    const v = VERDICT[r.verdict];
    status = html`<div class=${`msg ${v.cls}`}>
      <b>${v.label}</b>${r.evalText && html` <span class="muted">· Bewertung ${r.evalText}</span>`}
      ${left && left.type === 'forgot' && html`<p>Vorbereitung vergessen: Du hast <b>${de(left.played)}</b> gespielt, im Repertoire steht <b>${de(left.right)}</b>. Der Zug kommt wieder in die Wiederholung.</p>`}
      ${left && left.type === 'gap' && html`<p>Lücke gefunden: Auf <b>${de(left.san)}</b> hat dein Repertoire keine Antwort${left.share != null ? html` (spielen dort ${Math.round(left.share * 100)} %)` : ''}.</p>`}
      ${left && left.type === 'end' && html`<p>Deine Linie war zu Ende, danach hast du frei weitergespielt.</p>`}
      ${r.verdict === 'held' && html`<p>Du stehst etwas schlechter, aber noch im Rahmen.</p>`}
      ${r.verdict === 'lost' && left && left.type !== 'forgot' && html`<p>Nach der Vorbereitung ist die Stellung deutlich schlechter geworden.</p>`}
    </div>`;
  } else if (g.thinking) status = html`<div class="msg idle">Gegner zieht …</div>`;
  else if (g.phase === 'free') status = html`<div class="msg ask"><b>Raus aus der Vorbereitung.</b> Spiele noch ${g.freeLeft} ${g.freeLeft === 1 ? 'Zug' : 'Züge'} – dann wird die Stellung bewertet.</div>`;
  else status = html`<div class="msg ask">Du bist am Zug. Spiele, was in deinem Repertoire steht.</div>`;

  return html`<div class="trainer">
    <div>
      <${Board} orientation=${rep.color} onReady=${c => { cg.current = c; if (game.current) { game.current.cg = c; game.current.sync(); } }} onMove=${(o, d) => game.current && game.current.userMove(o, d)} />
    </div>
    <div class="card trainer-side">
      <div class="trainer-head">
        <div>
          <div class="eyebrow">Testpartie</div>
          <h2>${rep.name}</h2>
        </div>
        <button class="btn ghost small" onClick=${onExit}>Beenden</button>
      </div>
      <p class="muted small">Du spielst dein Repertoire gegen echte Gegnerzüge. Verlässt die Partie dein Repertoire, bewertet die Engine die Stellung.</p>
      <label class="small">Gegner
        <select value=${opp} onChange=${e => setSettings({ opponent: e.target.value })}>
          ${Object.entries(PRESETS).map(([k, p]) => html`<option value=${k}>${p.label}</option>`)}
          <option value="sf">Stockfish (Computer, ohne Anmeldung)</option>
        </select>
      </label>
      <div class="status">${status}</div>
      ${g && g.moves.length > 0 && html`<div class="tree">${de(g.moves.join(' '))}</div>`}
      <div class="row trainer-actions">
        ${g && g.phase === 'done' && html`<button class="btn primary" onClick=${() => g.start()}>Nächste Testpartie</button>`}
        ${g && g.phase === 'done' && where && left.type !== 'forgot' && html`<button class="btn" onClick=${() => onEdit(where)}>${left.type === 'gap' ? 'Lücke im Editor schließen' : 'Linie im Editor verlängern'}</button>`}
        ${g && g.phase !== 'done' && g.moves.length > 0 && html`<button class="btn small ghost" onClick=${() => g.start()}>Neu starten</button>`}
      </div>
      ${g && html`<div class="muted small">Diese Sitzung: ${g.tally.won} gewonnen · ${g.tally.held} gehalten · ${g.tally.lost} verloren</div>`}
      <div class="row toggles">
        <label class="check"><input type="checkbox" checked=${settings.sound} onChange=${e => setSettings({ sound: e.target.checked })} /> Ton</label>
      </div>
    </div>
  </div>`;
}
