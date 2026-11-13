import { html, useMemo, useRef, useState } from 'preact';
import { chessgroundDests } from 'chessops/compat.js';
import { makeSan } from 'chessops/san.js';
import { parseSquare } from 'chessops/util.js';
import { de, moveLabel, posFromFen, turnOf } from '../lib/repertoire.js';
import { buildKeyTasks, scopeOf } from '../lib/srs.js';
import { Board } from './board.js';

/**
 * Schlüsselstellungen üben: Stellung zeigen, Nutzer spielt den richtigen Zug.
 * Richtig: Erklärung (Kommentar des Zuges). Falsch: Lösung und Erklärung.
 * Wiederholungsplan wie bei den Linien, aber als eigene Karten (Schlüssel "K:…").
 */
export function KeyTrainer({ rep, progress, settings, setSettings, onGrade, onExit, onMore }) {
  const tasks = useMemo(
    () => buildKeyTasks(rep, progress, { scope: scopeOf(settings, rep), size: settings.keySize ?? 10, shuffle: settings.keyShuffle !== false }),
    [],
  );
  const cgRef = useRef(null);
  const [i, setI] = useState(0);
  const [state, setState] = useState({ phase: 'ask', hinted: false, failed: false, msg: null });
  const [stats, setStats] = useState({ ok: 0, bad: 0 });
  const [missed, setMissed] = useState([]);
  const finished = i >= tasks.length;
  const task = tasks[Math.min(i, tasks.length - 1)];
  const graded = useRef(false);

  const show = (t, movable) => {
    const cg = cgRef.current;
    if (!cg) return;
    const pos = posFromFen(t.fen);
    cg.set({
      fen: t.fen,
      turnColor: turnOf(t.fen),
      lastMove: [t.lastFrom, t.lastTo],
      check: pos.isCheck(),
      movable: { color: movable ? rep.color : undefined, dests: movable ? chessgroundDests(pos) : new Map() },
    });
    cg.setAutoShapes([]);
  };

  const onReady = cg => {
    cgRef.current = cg;
    if (tasks.length) show(tasks[0], true);
  };

  const grade = ok => {
    if (graded.current) return;
    graded.current = true;
    onGrade(task.id, ok);
    setStats(s => ({ ok: s.ok + (ok ? 1 : 0), bad: s.bad + (ok ? 0 : 1) }));
    if (!ok) setMissed(m => [...m, task]);
  };

  const reveal = (ok, text) => {
    const cg = cgRef.current;
    const c = task.correct;
    cg.set({
      fen: c.fen,
      turnColor: turnOf(c.fen),
      lastMove: [c.from, c.to],
      movable: { color: undefined, dests: new Map() },
    });
    cg.setAutoShapes(ok ? [] : [{ orig: c.from, dest: c.to, brush: 'green' }]);
    setState(s => ({ ...s, phase: ok ? 'right' : 'wrong', msg: text }));
  };

  const onMove = (orig, dest) => {
    if (state.phase !== 'ask' || finished) return;
    const pos = posFromFen(task.fen);
    const move = { from: parseSquare(orig), to: parseSquare(dest) };
    const piece = pos.board.get(move.from);
    if (piece && piece.role === 'pawn' && (move.to >> 3 === 0 || move.to >> 3 === 7)) {
      const c = task.correct;
      move.promotion = c.promotion && c.from === orig && c.to === dest ? c.promotion : 'queen';
    }
    const san = makeSan(pos, move);
    if (san === task.correct.san) {
      const clean = !state.hinted && !state.failed;
      grade(clean);
      reveal(true, { kind: 'ok', head: `${de(san)} – richtig!`, text: task.correct.comment });
      return;
    }
    const alt = task.alts.find(a => a.san === san);
    if (alt) {
      setState(s => ({ ...s, msg: { kind: 'info', head: `${de(san)} steht auch im Repertoire – hier ist aber ein anderer Zug gesucht.`, text: '' } }));
      setTimeout(() => show(task, true), 350);
      return;
    }
    // falsch: Lösung zeigen
    grade(false);
    setState(s => ({ ...s, failed: true }));
    reveal(false, {
      kind: 'bad',
      head: `Leider falsch. Gesucht war ${moveLabel(task.fen)} ${de(task.correct.san)}.`,
      text: task.correct.comment,
      extra: alt ? alt.comment : '',
    });
  };

  const hint = () => {
    if (state.phase !== 'ask') return;
    setState(s => ({ ...s, hinted: true, msg: { kind: 'info', head: 'Tipp: Die markierte Figur zieht.', text: '' } }));
    cgRef.current.setAutoShapes([{ orig: task.correct.from, brush: 'green' }]);
  };

  const solve = () => {
    if (state.phase !== 'ask') return;
    grade(false);
    reveal(false, { kind: 'info', head: `Lösung: ${moveLabel(task.fen)} ${de(task.correct.san)}`, text: task.correct.comment });
  };

  const next = () => {
    graded.current = false;
    const n = i + 1;
    setI(n);
    setState({ phase: 'ask', hinted: false, failed: false, msg: null });
    if (n < tasks.length) show(tasks[n], true);
  };

  if (!tasks.length) {
    return html`<div class="card center">
      <h2>Schlüsselstellungen: ${rep.name}</h2>
      <p>Im Moment ist hier nichts fällig und nichts Neues in der gewählten Auswahl.</p>
      <button class="btn primary" onClick=${onExit}>Zurück zur Übersicht</button>
    </div>`;
  }

  const pct = tasks.length ? ((finished ? tasks.length : i + (state.phase === 'ask' ? 0 : 1)) / tasks.length) * 100 : 0;
  const total = stats.ok + stats.bad;

  return html`<div class="trainer">
    <div class="trainer-board">
      <${Board} orientation=${rep.color} onReady=${onReady} onMove=${onMove} />
    </div>
    <div class="trainer-side card">
      <div class="trainer-head">
        <div>
          <div class="eyebrow">Schlüsselstellungen · ${rep.name}</div>
          <h2>${finished ? 'Geschafft' : rep.chapters[task.chapter].name}</h2>
        </div>
        <button class="btn ghost small" onClick=${onExit}>Beenden</button>
      </div>
      <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
      <div class="muted small">Stellung ${Math.min(i + 1, tasks.length)} von ${tasks.length}</div>

      ${finished
        ? html`<div class="finish">
            <h3>Sitzung beendet</h3>
            <div class="result">
              <div class="result-nums">
                <div><b class="ok">${stats.ok}</b><span>richtig</span></div>
                <div><b class="bad">${stats.bad}</b><span>falsch</span></div>
                ${total > 0 && html`<div><b>${Math.round((stats.ok / total) * 100)} %</b><span>von ${total} Stellungen</span></div>`}
              </div>
              ${missed.length > 0 && html`<div class="small muted">Das hast du verpasst: ${missed.map(m => `${moveLabel(m.fen)} ${de(m.correct.san)}`).join(' · ')}</div>`}
            </div>
            <div class="row">
              <button class="btn primary" onClick=${onMore}>Weitere Stellungen</button>
              <button class="btn" onClick=${onExit}>Zurück zur Übersicht</button>
            </div>
          </div>`
        : html`<div class="status">
              ${state.phase === 'ask' && html`<div class="msg ask">Schlüsselstellung: Du bist am Zug (${rep.color === 'white' ? 'Weiß' : 'Schwarz'}). Was spielst du?</div>`}
              ${state.phase === 'ask' && task.text && html`<p class="muted small">${task.text}</p>`}
              ${state.msg && html`<div class=${`msg ${state.msg.kind}`}>
                <div><b>${state.msg.head}</b></div>
                ${state.msg.text && html`<p>${state.msg.text}</p>`}
                ${state.msg.extra && html`<p class="muted">${state.msg.extra}</p>`}
              </div>`}
            </div>
            <div class="row trainer-actions">
              ${state.phase === 'ask' && html`
                <button class="btn small" onClick=${hint}>💡 Tipp</button>
                <button class="btn small" onClick=${solve}>Lösung zeigen</button>`}
              ${state.phase !== 'ask' && html`<button class="btn primary" onClick=${next}>${i + 1 < tasks.length ? 'Weiter' : 'Fertig'}</button>`}
            </div>`}
      <div class="row toggles">
        <label class="check"><input type="checkbox" checked=${settings.keyShuffle !== false} onChange=${ev => setSettings({ keyShuffle: ev.target.checked })} /> Gemischt (gilt ab der nächsten Sitzung)</label>
      </div>
    </div>
  </div>`;
}
