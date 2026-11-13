import { html, useEffect, useMemo, useReducer, useRef } from 'preact';
import { de } from '../lib/repertoire.js';
import { chessgroundDests } from 'chessops/compat.js';
import { makeSan } from 'chessops/san.js';
import { parseSquare } from 'chessops/util.js';
import { derived, epdOf, moveLabel, moveText, posFromFen, turnOf } from '../lib/repertoire.js';
import { buildTasks, scopeOf } from '../lib/srs.js';
import { sounds } from '../lib/sound.js';
import { Board } from './board.js';

/**
 * Ablauf einer Sitzung. Pro Aufgabe (Linie):
 *  learn:  Durchgang "teach" (neue Züge werden mit Pfeil gezeigt und nachgespielt),
 *          danach Durchgang "quiz" (dieselben Züge ohne Hilfe).
 *  review / practice: nur "quiz".
 * Gegnerzüge und nicht abgefragte eigene Züge werden automatisch gespielt.
 */
class Engine {
  constructor(o) {
    Object.assign(this, o);
    this.timers = new Set();
    this.taskNo = 0;
    this.stats = { ok: 0, bad: 0 };
    this.missed = new Map(); // Schlüssel -> { line, i } der verpassten Züge
    this.phase = 'idle';
    this.message = null;
    this.shown = 0;
    this.waiting = false;
  }

  later(fn, ms) {
    const tempo = { slow: 1.7, fast: 0.55 }[this.opts().tempo] || 1; // Tempo der vorgespielten Züge
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.dead) fn();
    }, ms * tempo);
    this.timers.add(t);
  }

  destroy() {
    this.dead = true;
    this.timers.forEach(clearTimeout);
  }

  get line() {
    return this.tasks[this.taskNo].line;
  }

  fenBefore(i) {
    return i === 0 ? this.line.startFen : this.line.nodes[i - 1].fen;
  }

  start() {
    if (!this.tasks.length) {
      this.phase = 'finished';
      this.onChange();
      return;
    }
    this.startTask();
  }

  startTask() {
    const t = this.tasks[this.taskNo];
    this.ask = new Set(t.ask);
    this.first = Math.min(...t.ask);
    this.last = Math.max(...t.ask);
    this.graded = false;
    this.message = null;
    this.startPass(this.mode === 'learn' && this.opts().teach ? 'teach' : 'quiz');
  }

  sound(name) {
    if (this.opts().sound) sounds[name]();
  }

  startPass(kind) {
    this.phase = kind;
    this.errors = new Set();
    this.waiting = false;
    const start = kind === 'teach' ? 0 : Math.max(0, this.first - 1);
    this.i = start;
    this.shown = start;
    this.showPosition(start, false);
    this.cg.setAutoShapes([]);
    this.onChange();
    this.later(() => this.step(), 600);
  }

  /** Stellung vor Zug i anzeigen. */
  showPosition(i, movable) {
    const fen = this.fenBefore(i);
    const prev = i > 0 ? this.line.nodes[i - 1] : null;
    const pos = posFromFen(fen);
    this.cg.set({
      fen,
      turnColor: turnOf(fen),
      lastMove: prev ? [prev.from, prev.to] : undefined,
      check: pos.isCheck(),
      movable: { color: movable ? this.rep.color : undefined, dests: movable ? chessgroundDests(pos) : new Map() },
    });
  }

  playNode(i) {
    const n = this.line.nodes[i];
    this.cg.set({
      fen: n.fen,
      turnColor: turnOf(n.fen),
      lastMove: [n.from, n.to],
      check: posFromFen(n.fen).isCheck(),
      movable: { color: undefined, dests: new Map() },
    });
    this.cg.setAutoShapes(this.phase === 'teach' ? n.shapes || [] : []);
    this.shown = i + 1;
  }

  hintShape() {
    const n = this.line.nodes[this.i];
    return [{ orig: n.from, dest: n.to, brush: 'green' }];
  }

  /** Nur die Figur markieren, die zieht. */
  pieceShape() {
    return [{ orig: this.line.nodes[this.i].from, brush: 'green' }];
  }

  step() {
    if (this.i > this.last) return this.passDone();
    if (this.ask.has(this.i)) {
      this.waiting = true;
      this.hinted = false;
      this.showPosition(this.i, true);
      this.cg.setAutoShapes(this.phase === 'teach' ? this.hintShape() : []);
      this.onChange();
    } else {
      this.playNode(this.i);
      this.i++;
      this.onChange();
      this.later(() => this.step(), this.phase === 'teach' ? 700 : 500);
    }
  }

  onUserMove(orig, dest) {
    if (!this.waiting) return;
    const i = this.i;
    const node = this.line.nodes[i];
    const fen = this.fenBefore(i);
    const pos = posFromFen(fen);
    const move = { from: parseSquare(orig), to: parseSquare(dest) };
    const piece = pos.board.get(move.from);
    if (piece && piece.role === 'pawn' && (move.to >> 3 === 0 || move.to >> 3 === 7)) {
      move.promotion = node.promotion && node.from === orig && node.to === dest ? node.promotion : 'queen';
    }
    const san = makeSan(pos, move);
    this.waiting = false;

    if (san === node.san) {
      if (this.phase === 'quiz' && !this.errors.has(i)) this.stats.ok++;
      this.message = { kind: 'ok', text: `${moveText(fen, san)} – richtig!` };
      this.sound('ok');
      this.playNode(i);
      this.i++;
      this.onChange();
      this.later(() => this.step(), 450);
      return;
    }

    const known = this.index.get(epdOf(fen));
    const alt = known && known.has(san);
    if (alt) {
      this.message = { kind: 'info', text: `${moveText(fen, san)} steht auch im Repertoire – hier ist aber ein anderer Zug gesucht.` };
    } else {
      this.message = { kind: 'bad', text: `${moveText(fen, san)} ist nicht der Repertoirezug.` };
      this.sound('bad');
      if (this.phase === 'quiz') this.markError();
    }
    this.onChange();
    this.later(() => {
      this.showPosition(i, true);
      this.cg.setAutoShapes(this.phase === 'teach' ? this.hintShape() : this.hinted ? this.pieceShape() : []);
      this.waiting = true;
      this.onChange();
    }, 400);
  }

  markError() {
    if (!this.errors.has(this.i)) {
      this.errors.add(this.i);
      this.stats.bad++;
      const key = this.line.keys[this.i];
      if (key && !this.missed.has(key)) this.missed.set(key, { line: this.line, i: this.i });
    }
  }

  hint() {
    if (!this.waiting || this.phase !== 'quiz') return;
    this.markError();
    this.hinted = true;
    this.message = { kind: 'info', text: 'Tipp: Die markierte Figur zieht.' };
    this.cg.setAutoShapes(this.pieceShape());
    this.onChange();
  }

  /** Lösung: der Zug wird vorgespielt (zählt als Fehler). */
  solve() {
    if (!this.waiting || this.phase !== 'quiz') return;
    this.markError();
    this.waiting = false;
    const n = this.line.nodes[this.i];
    this.message = { kind: 'info', text: `Lösung: ${moveText(this.fenBefore(this.i), n.san)}` };
    this.playNode(this.i);
    this.cg.setAutoShapes(n.shapes || []);
    this.i++;
    this.onChange();
    this.later(() => this.step(), 1400);
  }

  passDone() {
    if (this.phase === 'teach') {
      this.message = { kind: 'info', text: 'Gut! Jetzt dieselben Züge aus dem Gedächtnis.' };
      this.onChange();
      this.later(() => this.startPass('quiz'), 1200);
      return;
    }
    if (!this.graded) {
      this.graded = true;
      for (const idx of this.ask) this.onGrade(this.line.keys[idx], !this.errors.has(idx));
    }
    this.lineOk = this.errors.size === 0;
    if (this.lineOk) this.sound('done');
    this.phase = 'lineDone';
    this.message = null;
    this.onChange();
  }

  repeat() {
    this.message = null;
    this.startPass('quiz');
  }

  next() {
    if (this.taskNo + 1 < this.tasks.length) {
      this.taskNo++;
      this.startTask();
    } else {
      this.phase = 'finished';
      this.onChange();
    }
  }
}

const MODE_TITLE = { learn: 'Lernen', review: 'Wiederholen', practice: 'Üben' };

export function Trainer({ rep, progress, mode, chapter, focusKey, visits, settings, setSettings, onGrade, onExit, onMore, onDone, onPractice, redo }) {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const d = derived(rep);
  const tasks = useMemo(() => buildTasks(rep, progress, mode, { chapter, key: focusKey, visits, depth: settings.depth || 0, alts: !!settings.alts, scope: scopeOf(settings, rep) }), []);
  const [, force] = useReducer(x => x + 1, 0);
  const eng = useRef(null);
  const gradeRef = useRef(onGrade);
  gradeRef.current = onGrade;

  const onReady = cg => {
    const e = new Engine({
      cg,
      rep,
      tasks,
      mode,
      index: d.index,
      opts: () => settingsRef.current,
      onChange: force,
      onGrade: (key, ok) => mode !== 'practice' && gradeRef.current(key, ok),
    });
    eng.current = e;
    e.start();
  };

  useEffect(() => () => eng.current && eng.current.destroy(), []);
  const reported = useRef(false);
  useEffect(() => {
    if (!reported.current && eng.current && eng.current.phase === 'finished') {
      reported.current = true;
      if (onDone) onDone(eng.current.stats);
    }
  });
  useEffect(() => {
    const h = ev => {
      const e = eng.current;
      if (e && e.phase === 'lineDone' && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        e.next();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!tasks.length) {
    return html`<div class="card center">
      <h2>${MODE_TITLE[mode]}: ${rep.name}</h2>
      <p>${mode === 'learn' ? settings.depth ? `Bis Zug ${settings.depth} ist hier alles gelernt. Stell die Lerntiefe höher, um weiterzumachen.` : 'Hier gibt es keine neuen Züge mehr – alles gelernt!' : mode === 'review' ? 'Im Moment ist nichts fällig.' : 'Diese Linie wurde im Repertoire nicht gefunden.'}</p>
      <button class="btn primary" onClick=${onExit}>Zurück zur Übersicht</button>
    </div>`;
  }

  const e = eng.current;
  const finished = e && e.phase === 'finished';
  const line = e && !finished ? e.line : tasks[0].line;
  const taskNo = e ? e.taskNo : 0;
  const done = finished ? tasks.length : taskNo + (e && e.phase === 'lineDone' ? 1 : 0);

  return html`<div class="trainer">
    <div class="trainer-board">
      <${Board} orientation=${rep.color} onReady=${onReady} onMove=${(o, t) => eng.current && eng.current.onUserMove(o, t)} />
    </div>
    <div class="trainer-side card">
      <div class="trainer-head">
        <div>
          <div class="eyebrow">${MODE_TITLE[mode]} · ${rep.name}</div>
          <h2>${rep.chapters[line.chapter].name}</h2>
          ${rep.videos && rep.videos[rep.chapters[line.chapter].name] && html`<a class="btn ghost small" href=${rep.videos[rep.chapters[line.chapter].name]} target="_blank" rel="noopener">▶ Video zum Kapitel</a>`}
        </div>
        <button class="btn ghost small" onClick=${onExit}>Beenden</button>
      </div>
      <div class="progress"><div style=${{ width: `${(done / tasks.length) * 100}%` }}></div></div>
      <div class="muted small">
        ${Array.isArray(focusKey) ? 'Stellung' : 'Linie'} ${Math.min(taskNo + 1, tasks.length)} von ${tasks.length}
        ${mode === 'learn' && visits && visits.size > 0 && ' · häufigste Linien aus deinen Partien zuerst'}
        ${Array.isArray(focusKey) && (redo ? ' · deine Fehler aus der letzten Sitzung' : ' · hier bist du in deinen Partien abgewichen')}
      </div>

      ${finished
        ? html`<div class="finish">
            <h3>Sitzung beendet</h3>
            <${Result} e=${e} />
            <div class="row">
              ${e.missed.size > 0 && onPractice && html`<button class="btn accent" onClick=${() => onPractice([...e.missed.keys()])}>Fehler nochmal üben (${e.missed.size})</button>`}
              ${mode === 'learn' && html`<button class="btn primary" onClick=${onMore}>Weiter lernen</button>`}
              <button class="btn" onClick=${onExit}>Zurück zur Übersicht</button>
            </div>
          </div>`
        : html`<${Status} e=${e} rep=${rep} />
            <${MoveList} e=${e} line=${line} />
            <div class="row trainer-actions">
              ${e && e.phase === 'quiz' && html`
                <button class="btn small" disabled=${!e.waiting} onClick=${() => e.hint()}>💡 Tipp</button>
                <button class="btn small" disabled=${!e.waiting} onClick=${() => e.solve()}>Lösung zeigen</button>`}
              ${e && e.phase === 'lineDone' && html`
                <button class="btn primary" onClick=${() => e.next()}>Weiter ⏎</button>
                <button class="btn" onClick=${() => e.repeat()}>Linie nochmal</button>`}
            </div>`}
      <div class="row toggles">
        ${mode === 'learn' && html`<label class="check" title="Aus: Du wirst sofort abgefragt und nutzt Tipp oder Lösung, wenn du einen Zug nicht kennst. Gilt ab der nächsten Linie.">
          <input type="checkbox" checked=${settings.teach} onChange=${ev => setSettings({ teach: ev.target.checked })} /> Neue Züge erst vorspielen
        </label>`}
        <label class="check"><input type="checkbox" checked=${settings.sound} onChange=${ev => setSettings({ sound: ev.target.checked })} /> Ton</label>
      </div>
    </div>
  </div>`;
}

function Result({ e }) {
  const { ok, bad } = e.stats;
  const total = ok + bad;
  const pct = total ? Math.round((ok / total) * 100) : 0;
  const missed = [...e.missed.values()];
  return html`<div class="result">
    <div class="result-nums">
      <div><b class="ok">${ok}</b><span>richtig</span></div>
      <div><b class="bad">${bad}</b><span>${bad === 1 ? 'falsch' : 'falsch'}</span></div>
      ${total > 0 && html`<div><b>${pct} %</b><span>von ${total} Abfragen</span></div>`}
    </div>
    ${missed.length > 0 && html`<div>
      <div class="small muted">Das hast du verpasst:</div>
      <ul class="missed">
        ${missed.map(m => {
          const before = m.i ? m.line.nodes[m.i - 1].fen : m.line.startFen;
          return html`<li><b>${moveText(before, m.line.nodes[m.i].san)}</b></li>`;
        })}
      </ul>
    </div>`}
  </div>`;
}

function Status({ e, rep }) {
  if (!e) return null;
  let prompt;
  if (e.phase === 'lineDone') {
    prompt = e.lineOk
      ? html`<div class="msg ok">Linie fehlerfrei gespielt.</div>`
      : html`<div class="msg bad">Linie mit Fehlern – sie kommt bald wieder dran.</div>`;
  } else if (e.waiting && e.phase === 'teach') {
    const n = e.line.nodes[e.i];
    prompt = html`<div class="msg teach">
      <div>Neuer Zug: spiele <b>${moveText(e.fenBefore(e.i), n.san)}${n.glyph || ''}</b></div>
      ${n.comment && html`<p>${n.comment}</p>`}
    </div>`;
  } else if (e.waiting) {
    prompt = html`<div class="msg ask">Du bist am Zug (${rep.color === 'white' ? 'Weiß' : 'Schwarz'}). Was ist der Repertoirezug?</div>`;
  } else {
    prompt = html`<div class="msg idle">…</div>`;
  }
  return html`<div class="status">
    ${prompt}
    ${e.message && e.phase !== 'lineDone' && html`<div class=${`msg ${e.message.kind}`}>${e.message.text}</div>`}
  </div>`;
}

function MoveList({ e, line }) {
  const ref = useRef(null);
  const shown = e ? e.shown : 0;
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [shown]);
  const items = [];
  for (let i = 0; i < shown; i++) {
    const n = line.nodes[i];
    const before = i ? line.nodes[i - 1].fen : line.startFen;
    const label = moveLabel(before);
    const showLabel = label.endsWith('.') || i === 0 || line.nodes[i - 1].comment;
    items.push(html`<span class=${`mv ${line.keys[i] ? 'mine' : ''} ${i === shown - 1 ? 'last' : ''}`}>
      ${showLabel && html`<span class="no">${label}</span>`}${de(n.san)}${n.glyph || ''}
    </span>`);
    if (n.comment) items.push(html`<span class="cm">${n.comment}</span>`);
  }
  return html`<div class="movelist" ref=${ref}>${items.length ? items : html`<span class="muted">Grundstellung</span>`}</div>`;
}
