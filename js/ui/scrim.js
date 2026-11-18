// Testpartie: das Repertoire gegen Gegnerzüge spielen, die nach echter Häufigkeit gezogen werden.
// Gegner: Lichess-Datenbank (echte Partien), Maia (Netz, das wie ein Mensch einer Spielstärke zieht) oder Stockfish.
// Liefert die Datenbank keinen Zug mehr, spielt Maia weiter; ist Maia nicht ladbar (z. B. offline), Stockfish.
// Verlässt die Partie die Vorbereitung, folgen ein paar freie Züge, dann bewertet Stockfish die Stellung.
import { html, useEffect, useReducer, useRef, useState } from 'preact';
import { de } from '../lib/repertoire.js';
import { chessgroundDests } from 'chessops/compat.js';
import { makeFen } from 'chessops/fen.js';
import { makeSanAndPlay, parseSan } from 'chessops/san.js';
import { parseSquare, parseUci } from 'chessops/util.js';
import { derived, epdOf, moveKeys, moveLabel, posFromFen, turnOf, whiteLabel } from '../lib/repertoire.js';
import { StockfishEngine, formatScore } from '../lib/engine.js';
import { PRESETS, explore, startLogin } from '../lib/lichess.js';
import { locate } from '../lib/coverage.js';
import { MAIA_DEFAULT, MAIA_LEVELS, loadMaia, maiaPick } from '../lib/maia.js';
import { sounds } from '../lib/sound.js';
import { Board } from './board.js';

const FREE_MOVES = 3;
// Maia-Spielstärke, wenn die Lichess-Datenbank zu Ende ist: passend zum gewählten Bereich
const PRESET_ELO = { low: 1200, mid: 1600, high: 2000, top: 2400, masters: 2400 };
let maiaReady = false;
const DEPTH = 14;
// Bewertung der Stellung nach der Vorbereitung, aus eigener Sicht (in Bauerneinheiten):
// bis 0,25 ausgeglichen, 0,25–0,75 etwas besser, 0,75–1,5 klar besser, darüber auf Gewinn (wie die Informator-Zeichen = ⩲ ± +−)
const VERDICT = {
  win: { label: 'Du stehst auf Gewinn', cls: 'ok' },
  clear: { label: 'Du stehst klar besser', cls: 'ok' },
  better: { label: 'Du stehst etwas besser', cls: 'ok' },
  equal: { label: 'Ausgeglichen', cls: 'ask' },
  worse: { label: 'Du stehst etwas schlechter', cls: 'ask' },
  clearWorse: { label: 'Du stehst klar schlechter', cls: 'bad' },
  lost: { label: 'Du stehst auf Verlust', cls: 'bad' },
};
const verdictOf = cp =>
  cp > 150 ? 'win' : cp > 75 ? 'clear' : cp > 25 ? 'better' : cp >= -25 ? 'equal' : cp >= -75 ? 'worse' : cp >= -150 ? 'clearWorse' : 'lost';
const GAP_SHARE = 0.05; // ab diesem Anteil der Partien gilt ein fehlender Gegnerzug als mögliche Lücke
const OPP_INFO = {
  db: 'Zieht wie Spieler dieser Spielstärke auf Lichess. Jeder Zug wird nach Häufigkeit ausgelost: Ein Zug aus 40 % der Partien kommt in etwa 40 % der Fälle, ein seltener Zug nur ab und zu. So triffst du auch auf Nebenvarianten. Kennt die Datenbank keine Partien mehr, spielt Maia weiter. Braucht eine Lichess-Anmeldung.',
  maia: 'Ein Computer, der wie ein Mensch der gewählten Spielstärke zieht, mit typischen menschlichen Zügen und Fehlern. Läuft ohne Anmeldung direkt auf deinem Gerät.',
  sf: 'Die stärkste Schach-Engine. Spielt immer den Zug, den sie für den besten hält. Gut, um zu prüfen, ob deine Vorbereitung auch gegen die beste Antwort hält.',
};
const OPP_TEXT = {
  db: 'Du spielst dein Repertoire gegen Züge, die Lichess-Spieler in der Stellung wählen.',
  maia: 'Du spielst dein Repertoire gegen Maia, die wie ein Mensch zieht.',
  sf: 'Du spielst dein Repertoire gegen Stockfish.',
};

/** Stockfish für einzelne Abfragen: eval(fen) -> beste Variante (Bewertung aus Sicht von Weiß). */
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
    this.tally = { games: 0, clean: 0, gaps: 0 };
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
    this.retry = null; // falscher Zug in der Vorbereitung: { right } (nochmal probieren)
    this.mistakes = 0;
    this.thinking = false;
    this.loadingMaia = false;
    this.sync();
    this.step();
  }

  /** Nach einem falschen Zug: den Repertoirezug zeigen. */
  showSolution() {
    if (!this.retry) return;
    this.arrow = this.retry.arrow;
    this.retry.shown = true;
    this.sync();
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
    this.moves.push(whiteLabel(label) || !this.moves.length ? `${label}${san}` : san);
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

  /** Zug von Maia (lädt das Netz beim ersten Mal). -> { move, share } | null, wenn Maia nicht verfügbar ist */
  async maia(fen, elo) {
    const run = this.run;
    try {
      if (!maiaReady) {
        this.loadingMaia = true;
        this.sync();
        await loadMaia();
        maiaReady = true;
      }
      const m = await maiaPick(fen, elo);
      return m ? { move: m.move, share: m.p } : null;
    } catch (err) {
      console.warn('Maia nicht verfügbar', err);
      return null;
    } finally {
      if (run === this.run) this.loadingMaia = false;
    }
  }

  async opponent() {
    const run = this.run;
    const fen = this.fen;
    this.thinking = true;
    this.sync();
    const { preset, token, maiaElo } = this.opts();
    let pick = null;
    if (preset === 'maia') pick = await this.maia(fen, maiaElo || MAIA_DEFAULT);
    else try {
      if (preset === 'sf') throw new Error('Stockfish als Gegner');
      const data = await explore(fen, preset, token);
      const total = data.white + data.draws + data.black;
      if (total >= 20 && data.moves.length) {
        const list = data.moves.map(m => ({ san: m.san, n: m.white + m.draws + m.black }));
        let x = Math.random() * list.reduce((s, m) => s + m.n, 0);
        const m = list.find(m => (x -= m.n) < 0) || list[0];
        const move = parseSan(posFromFen(fen), m.san);
        if (move) pick = { move, share: m.n / total, db: true };
      }
    } catch (err) {
      // Lichess-Anmeldung abgelaufen: abmelden und mit Maia weiterspielen (siehe unten)
      if (err.auth && run === this.run) this.onAuth && this.onAuth();
    }
    // keine Partien mehr in der Datenbank: Maia spielt menschlich weiter
    if (!pick && preset !== 'sf' && preset !== 'maia' && run === this.run) pick = await this.maia(fen, PRESET_ELO[preset] || maiaElo || MAIA_DEFAULT);
    if (!pick) {
      // Stockfish als Gegner gewählt oder Maia nicht verfügbar
      // Etwas Abwechslung: zufällig einer der Züge, die höchstens 0,3 schlechter sind als der beste.
      const lines = (await this.judge.eval(fen)) || [];
      const sign = turnOf(fen) === 'white' ? 1 : -1;
      const val = l => sign * (l.mate != null ? Math.sign(l.mate) * 100000 : l.cp);
      // Stockfish gewählt: immer der beste Zug. Nur als Ersatz für Maia (offline) etwas Abwechslung.
      const good = preset === 'sf' ? lines.slice(0, 1) : lines.filter(l => val(l) >= val(lines[0]) - 30);
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
      else if (!known.has(san)) {
        // Häufigkeit gibt es nur bei Zügen aus der Datenbank (bei Maia ist share die Netz-Wahrscheinlichkeit)
        const share = pick.db ? pick.share : null;
        const type = share == null ? 'novel' : share >= GAP_SHARE ? 'gap' : 'rare';
        if (type === 'gap') this.tally.gaps++;
        this.leave({ type, fen, san: `${moveLabel(fen)}${san}`, share });
      }
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
        // eigene Variante endet auf einem Gegnerzug: ab hier frei
        this.leave({ type: 'end', fen });
      } else {
        const san = makeSanAndPlay(pos.clone(), move);
        if (!known.has(san)) {
          const [right, keys] = known.entries().next().value;
          // Für die Wiederholung zählt es als Fehler (einmal pro Stellung); der Zug wird nicht ausgeführt
          if (!this.retry || this.retry.fen !== fen) {
            this.onGrade(`${epdOf(fen)}|${right}`, false);
            this.mistakes++;
          }
          this.retry = { fen, played: `${moveLabel(fen)}${san}`, right: `${moveLabel(fen)}${right}`, arrow: { orig: keys.from, dest: keys.to, brush: 'green' }, shown: !!(this.retry && this.retry.fen === fen && this.retry.shown) };
          if (this.opts().sound) sounds.bad();
          return this.sync();
        }
        this.retry = null;
        this.arrow = null;
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
    this.end(verdictOf(score), text);
  }

  end(verdict, evalText) {
    this.phase = 'done';
    this.result = { verdict, evalText };
    this.tally.games++;
    if (!this.mistakes) this.tally.clean++;
    if (VERDICT[verdict].cls !== 'bad' && this.opts().sound) sounds.done();
    this.sync();
  }

  destroy() {
    this.run++;
    this.judge.destroy();
  }
}

/** Liegt Maia schon im Gerätespeicher? (null = noch unbekannt) */
let maiaCachedKnown = null;
function useMaiaCached() {
  const [v, setV] = useState(maiaCachedKnown);
  useEffect(() => {
    if (maiaCachedKnown !== null) return;
    const url = new URL('../../vendor/maia/maia3-5m.fp16.onnx', import.meta.url).href;
    (window.caches ? caches.match(url, { ignoreSearch: true }) : Promise.resolve(null))
      .then(hit => setV((maiaCachedKnown = !!hit)))
      .catch(() => setV(false));
  }, []);
  return v;
}

export function Scrim({ rep, reps = [], onSwitch, settings, setSettings, onGrade, onExit, onEdit }) {
  const [, force] = useReducer(x => x + 1, 0);
  const maiaCached = useMaiaCached();
  const [info, setInfo] = useState(null); // aufgeklappte Erklärung zu einem Gegner
  const token = settings.lichessToken;
  const optsRef = useRef(null);
  // Gegner: 'db' (echte Partien aus der Lichess-Datenbank), 'maia' oder 'sf'.
  // Früher stand hier direkt die Datenbank-Gruppe (all, low, …): die gilt als 'db' mit dieser Gruppe.
  const legacy = settings.opponent && PRESETS[settings.opponent] ? settings.opponent : null;
  const opp = legacy ? 'db' : settings.opponent || (token ? 'db' : 'maia');
  const dbPreset = settings.oppDb || legacy || 'mid';
  const maiaElo = settings.maiaElo || MAIA_DEFAULT;
  // Datenbank ohne Lichess-Anmeldung: Maia spielt stattdessen (das Brett bleibt, daneben ein Hinweis)
  const dbNoLogin = opp === 'db' && !token;
  const preset = opp === 'db' ? (token ? dbPreset : 'maia') : opp;
  optsRef.current = { preset, token, sound: settings.sound, maiaElo: opp === 'db' ? PRESET_ELO[dbPreset] || maiaElo : maiaElo };
  const setOpp = v => setSettings({ opponent: v, ...(legacy ? { oppDb: legacy } : {}) });
  const gradeRef = useRef(onGrade);
  gradeRef.current = onGrade;
  const game = useRef(null);
  const cg = useRef(null);

  useEffect(() => {
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
  }, []);

  const g = game.current;
  const r = g && g.result;
  const left = g && g.left;
  const where = left && locate(rep, left.fen);

  let status;
  if (!g) status = html`<div class="msg idle">Lade …</div>`;
  else if (g.phase === 'judging') status = html`<div class="msg info">Stockfish bewertet die Stellung …</div>`;
  else if (g.phase === 'done') {
    const v = VERDICT[r.verdict];
    const pct = left && left.share != null ? Math.round(left.share * 100) : null;
    status = html`<div class=${`msg ${v.cls}`}>
      <b>${v.label}</b>${r.evalText && html` <span class="muted">(${r.evalText.replace('.', ',')})</span>`}
      ${left && left.type === 'gap' && html`<p><b>Mögliche Lücke:</b> ${de(left.san)} steht nicht in deinem Repertoire (in ${pct} % der Partien gespielt).</p>`}
      ${left && left.type === 'rare' && html`<p>Seltener Zug: ${de(left.san)} steht nicht in deinem Repertoire (in ${pct < 1 ? 'unter 1' : pct} % der Partien gespielt).</p>`}
      ${left && left.type === 'novel' && html`<p>${de(left.san)} steht nicht in deinem Repertoire.</p>`}
      ${left && left.type === 'end' && html`<p>Deine Variante war zu Ende, danach hast du frei weitergespielt.</p>`}
      ${g.mistakes > 0 && html`<p class="small">${g.mistakes === 1 ? 'Ein Zug musste' : `${g.mistakes} Züge mussten`} nochmal probiert werden; ${g.mistakes === 1 ? 'er kommt' : 'sie kommen'} bald wieder in die Wiederholung.</p>`}
    </div>`;
  } else if (g.retry) {
    status = html`<div class="msg bad">
      <b>Nicht ganz.</b> ${de(g.retry.played)} steht nicht in deinem Repertoire. Probier's nochmal.
      ${g.retry.shown ? html`<p>Im Repertoire steht <b>${de(g.retry.right)}</b> (grüner Pfeil).</p>` : html`<div><button class="link" onClick=${() => g.showSolution()}>Lösung zeigen</button></div>`}
    </div>`;
  } else if (g.thinking) status = html`<div class="msg idle">${g.loadingMaia ? 'Maia wird geladen (einmalig ca. 22 MB) …' : 'Gegner zieht …'}</div>`;
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
          ${!(reps.length > 1 && onSwitch) && html`<h2>${rep.name}</h2>`}
        </div>
        <button class="btn ghost small" onClick=${onExit}>Beenden</button>
      </div>
      ${reps.length > 1 && onSwitch && html`<label class="scrim-rep">Wähle dein Repertoire
        <select value=${rep.id} onChange=${e => onSwitch(e.target.value)}>
          ${['white', 'black'].map(c => reps.some(r => r.color === c) && html`<optgroup label=${c === 'white' ? 'Mit Weiß' : 'Mit Schwarz'}>
            ${reps.filter(r => r.color === c).map(r => html`<option value=${r.id}>${r.name}</option>`)}
          </optgroup>`)}
        </select>
      </label>`}
      <p class="muted small">${OPP_TEXT[opp] || OPP_TEXT.maia} Verlässt die Partie dein Repertoire, folgen noch ein paar Züge, dann bewertet Stockfish die Stellung.</p>
      <div class="opp-choice small" role="radiogroup" aria-label="Gegner">
        <b>Gegner</b>
        ${[['db', 'Lichess-Spieler'], ['maia', 'Maia-Bot'], ['sf', 'Stockfish', 'stärkste Stufe']].map(([k, t, sub]) => html`<div class="opp-row">
          <label class="check"><input type="radio" name="opp" checked=${opp === k} onChange=${() => setOpp(k)} /> ${t}${sub && html` <span class="muted">(${sub})</span>`}</label>
          <button class=${`info-btn ${info === k ? 'on' : ''}`} aria-label=${`Was ist ${t}?`} aria-expanded=${info === k} onClick=${() => setInfo(info === k ? null : k)}>i</button>
        </div>
        ${info === k && html`<p class="opp-info muted">${OPP_INFO[k]}</p>`}`)}
      </div>
      ${opp === 'db' && html`<label class="small">Spielstärke
        <select value=${dbPreset} onChange=${e => setSettings({ oppDb: e.target.value, ...(legacy ? { opponent: 'db' } : {}) })}>
          ${Object.entries(PRESETS).map(([k, p]) => html`<option value=${k}>${p.label.replace(/^Lichess – /, '')}</option>`)}
        </select>
      </label>`}
      ${dbNoLogin && html`<div class="msg info small">Lichess gibt seine Datenbank nur für angemeldete Nutzer frei. Bis dahin spielt Maia.${' '}
        <button class="link" onClick=${() => startLogin({ name: 'scrim', repId: rep.id })}>Mit Lichess anmelden</button></div>`}
      ${opp === 'maia' && html`<label class="small">Spielstärke
        <select value=${maiaElo} onChange=${e => setSettings({ maiaElo: +e.target.value })}>
          ${MAIA_LEVELS.map(l => html`<option value=${l}>ca. ${l} (Lichess-Wertung)</option>`)}
        </select>
      </label>`}
      ${(opp === 'maia' || dbNoLogin) && maiaCached === false && !maiaReady && html`<p class="muted small">Maia wird beim ersten Gegnerzug geladen: einmalig ca. 22 MB, danach auch ohne Internet. Am Handy am besten im WLAN starten.</p>`}
      <div class="status">${status}</div>
      ${g && g.moves.length > 0 && html`<div class="tree">${de(g.moves.join(' '))}</div>`}
      <div class="row trainer-actions">
        ${g && g.phase === 'done' && html`<button class="btn primary" onClick=${() => g.start()}>Nächste Testpartie</button>`}
        ${g && g.phase === 'done' && where && html`<button class="btn" onClick=${() => onEdit(where)}>${left.type === 'end' ? 'Variante im Editor verlängern' : 'Zug im Editor ergänzen'}</button>`}
        ${g && g.phase !== 'done' && g.moves.length > 0 && html`<button class="btn small ghost" onClick=${() => g.start()}>Neu starten</button>`}
      </div>
      ${g && g.tally.games > 0 && html`<div class="muted small">Diese Sitzung: ${g.tally.games} ${g.tally.games === 1 ? 'Partie' : 'Partien'} · Vorbereitung ${g.tally.clean}× sicher gespielt${g.tally.gaps ? ` · ${g.tally.gaps} mögliche ${g.tally.gaps === 1 ? 'Lücke' : 'Lücken'} gefunden` : ''}</div>`}
      <div class="row toggles">
        <label class="check"><input type="checkbox" checked=${settings.sound} onChange=${e => setSettings({ sound: e.target.checked })} /> Ton</label>
      </div>
    </div>
  </div>`;
}
