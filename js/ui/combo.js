// Seite „Repertoires kombinieren“: mehrere Repertoires in eine Reihenfolge bringen, optional „gilt ab Stellung“.
import { html, useMemo, useRef, useState } from 'preact';
import { chessgroundDests } from 'chessops/compat.js';
import { INITIAL_FEN, makeFen } from 'chessops/fen.js';
import { makeSanAndPlay, parseSan } from 'chessops/san.js';
import { parseSquare } from 'chessops/util.js';
import { de, moveKeys, moveText, posFromFen, turnOf } from '../lib/repertoire.js';
import { combine, fenAfter } from '../lib/combo.js';
import { repStats } from '../lib/srs.js';
import { Board } from './board.js';

/** Zugfolge als Text: „1.e4 e5 2.♘f3“ */
export function sansText(sans) {
  const pos = posFromFen(INITIAL_FEN);
  const out = [];
  for (const san of sans) {
    const fen = makeFen(pos.toSetup());
    const t = moveText(fen, san);
    out.push(turnOf(fen) === 'white' || !out.length ? t : de(san));
    makeSanAndPlay(pos, parseSan(pos, san));
  }
  return out.join(' ');
}

/** Stellung wählen: Züge ab der Grundstellung auf dem Brett spielen. */
function PositionPicker({ from, color, onPick, onCancel }) {
  const [sans, setSans] = useState(from || []);
  const cg = useRef(null);
  const sync = list => {
    const fen = fenAfter(list) || INITIAL_FEN;
    const pos = posFromFen(fen);
    let last;
    if (list.length) {
      const prev = posFromFen(fenAfter(list.slice(0, -1)));
      last = moveKeys(prev, parseSan(prev, list[list.length - 1]));
    }
    cg.current && cg.current.set({ fen, lastMove: last, turnColor: turnOf(fen), movable: { color: turnOf(fen), dests: chessgroundDests(pos) } });
  };
  const set = list => {
    setSans(list);
    sync(list);
  };
  const onMove = (orig, dest) => {
    const pos = posFromFen(fenAfter(sans) || INITIAL_FEN);
    const move = { from: parseSquare(orig), to: parseSquare(dest) };
    const piece = pos.board.get(move.from);
    if (piece && piece.role === 'pawn' && (move.to >> 3 === 0 || move.to >> 3 === 7)) move.promotion = 'queen';
    const san = makeSanAndPlay(pos, move);
    set([...sans, san]);
  };
  return html`<div class="combo-picker stack tight">
    <p class="muted small">Spiel auf dem Brett die Züge bis zu der Stellung, ab der dieses Repertoire gelten soll.</p>
    <div class="combo-board"><${Board} orientation=${color} onReady=${c => { cg.current = c; sync(sans); }} onMove=${onMove} /></div>
    <div><b>${sans.length ? sansText(sans) : 'Grundstellung'}</b></div>
    <div class="row">
      <button class="btn small" disabled=${!sans.length} onClick=${() => set(sans.slice(0, -1))}>◀ Zug zurück</button>
      <button class="btn small" disabled=${!sans.length} onClick=${() => set([])}>Von vorn</button>
    </div>
    <div class="row">
      <button class="btn primary small" onClick=${() => onPick(sans.length ? sans : null)}>${sans.length ? 'Ab dieser Stellung' : 'Überall gelten lassen'}</button>
      <button class="btn ghost small" onClick=${onCancel}>Abbrechen</button>
    </div>
  </div>`;
}

/**
 * reps: alle Repertoires (ohne gesperrte), combo: bestehendes kombiniertes Repertoire oder null,
 * progress: gesamter Lernstand (für die Vorschau), onSave({ name, color, parts }), onCancel
 */
export function ComboEditor({ reps, combo, progress, onSave, onCancel }) {
  const [name, setName] = useState(combo ? combo.name : '');
  const [color, setColor] = useState(combo ? combo.color : 'black');
  const [parts, setParts] = useState(() => (combo ? combo.combo.parts.map(p => ({ ...p })) : []));
  const [picking, setPicking] = useState(null); // Index des Teils, dessen Stellung gerade gewählt wird
  const [error, setError] = useState('');
  const sources = reps.filter(r => !r.combo && r.chapters && r.chapters.length);
  const byId = new Map(sources.map(r => [r.id, r]));
  const avail = sources.filter(r => r.color === color && !parts.some(p => p.repId === r.id));
  const live = parts.filter(p => byId.has(p.repId));

  const preview = useMemo(() => {
    if (!live.length) return null;
    const r = combine(color, live.map(p => ({ rep: byId.get(p.repId), from: p.from, label: byId.get(p.repId).name })));
    const fake = { id: '_vorschau', color, chapters: r.chapters };
    const merged = {};
    for (const p of live) Object.assign(merged, progress[p.repId] || {});
    const s = repStats(fake, merged);
    return { stats: r.stats, lines: s.lines, total: s.total, learned: s.learned };
  }, [color, JSON.stringify(live)]);

  const move = (i, d) => {
    const n = [...parts];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setParts(n);
  };
  const changeColor = c => {
    setColor(c);
    setParts(parts.filter(p => (byId.get(p.repId) || {}).color === c));
  };
  const save = () => {
    if (live.length < 2) return setError('Wähle mindestens zwei Repertoires aus.');
    if (preview && !preview.total) return setError('In dieser Zusammenstellung bleibt kein einziger Zug übrig.');
    onSave({ name: name.trim() || 'Kombiniertes Repertoire', color, parts: live });
  };

  return html`<div class="stack combo">
    <div><button class="link" onClick=${onCancel}>← Zurück</button></div>
    <div class="card">
      <h1 class="flat">${combo ? 'Kombiniertes Repertoire bearbeiten' : 'Repertoires kombinieren'}</h1>
      <p class="muted">Setze dein eigenes Repertoire aus mehreren Kursen und eigenen PGNs zusammen. Spielen zwei Repertoires in derselben Stellung verschiedene Züge, zählt das, das weiter oben steht. Die Züge des Gegners werden aus allen übernommen. Die Kurse selbst bleiben unverändert, und was du dort schon gelernt hast, gilt hier als gelernt.</p>
      <div class="grid2">
        <label>Name
          <input type="text" value=${name} onInput=${e => setName(e.target.value)} placeholder="z. B. Mein Schwarz-Repertoire" />
        </label>
        <label>Ich spiele mit
          <select value=${color} onChange=${e => changeColor(e.target.value)}>
            <option value="white">Weiß</option>
            <option value="black">Schwarz</option>
          </select>
        </label>
      </div>
    </div>

    <div class="card">
      <div class="row between"><h2 class="flat">Reihenfolge</h2><span class="muted small">oben zählt mehr</span></div>
      ${!parts.length && html`<p class="muted">Noch nichts ausgewählt. Füge unten mindestens zwei Repertoires hinzu.</p>`}
      ${parts.map((p, i) => {
        const r = byId.get(p.repId);
        const st = preview && r && preview.stats[live.indexOf(p)];
        return html`<div class="combo-part" key=${p.repId}>
          <div class="row between">
            <b>${i + 1}. ${r ? r.name : 'Nicht mehr vorhanden'}</b>
            <span class="row combo-tools">
              <button class="btn small" disabled=${i === 0} onClick=${() => move(i, -1)} title="Nach oben (zählt mehr)" aria-label="Nach oben">↑</button>
              <button class="btn small" disabled=${i === parts.length - 1} onClick=${() => move(i, 1)} title="Nach unten" aria-label="Nach unten">↓</button>
              <button class="btn small ghost" onClick=${() => setParts(parts.filter((_, j) => j !== i))} title="Entfernen" aria-label="Entfernen">✕</button>
            </span>
          </div>
          <div class="small">
            <span class="muted">Gilt:</span> ${p.from && p.from.length ? html`ab <b>${sansText(p.from)}</b>` : 'überall'}${' '}
            <button class="link small" onClick=${() => setPicking(picking === i ? null : i)}>ändern</button>
          </div>
          ${st && html`<div class="muted small">${st.lines ? `${st.lines} ${st.lines === 1 ? 'Variante' : 'Varianten'} übernommen` : 'Wird hier ganz von den Repertoires darüber ersetzt'}</div>`}
          ${picking === i && html`<${PositionPicker} from=${p.from} color=${color}
            onPick=${f => { setParts(parts.map((x, j) => (j === i ? { ...x, from: f } : x))); setPicking(null); }}
            onCancel=${() => setPicking(null)} />`}
        </div>`;
      })}
      ${avail.length > 0
        ? html`<label>Repertoire hinzufügen
            <select value="" onChange=${e => e.target.value && setParts([...parts, { repId: e.target.value, from: null }])}>
              <option value="">Auswählen …</option>
              ${avail.map(r => html`<option value=${r.id}>${r.name}</option>`)}
            </select>
          </label>`
        : html`<p class="muted small">Keine weiteren Repertoires mit ${color === 'white' ? 'Weiß' : 'Schwarz'} vorhanden.</p>`}
    </div>

    ${preview && html`<div class="card">
      <h2 class="flat">Ergebnis</h2>
      <div class="muted">${preview.lines} Varianten · ${preview.total} eigene Züge · davon ${preview.learned} schon gelernt</div>
    </div>`}
    ${error && html`<div class="msg bad">${error}</div>`}
    <div class="row">
      <button class="btn primary" onClick=${save}>${combo ? 'Speichern' : 'Kombiniertes Repertoire anlegen'}</button>
      <button class="btn ghost" onClick=${onCancel}>Abbrechen</button>
    </div>
  </div>`;
}
