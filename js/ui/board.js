import { html, useEffect, useReducer, useRef } from 'preact';
import { Chessground } from 'chessground';

/** Brett-Einstellungen, die für alle Bretter gelten (kommen aus den Einstellungen des Nutzers). */
export const boardPrefs = { showDests: true, anim: true, input: 'both', onResize: null };
const listeners = new Set();
export function setBoardPrefs(p) {
  Object.assign(boardPrefs, p);
  listeners.forEach(f => f());
}

const prefConfig = () => ({
  animation: { enabled: boardPrefs.anim, duration: 220 },
  movable: { showDests: boardPrefs.showDests },
  draggable: { enabled: boardPrefs.input !== 'click' },
  selectable: { enabled: boardPrefs.input !== 'drag' },
});

/**
 * Brett auf Basis von Lichess' chessground, mit Koordinaten außen am Rahmen.
 * - Mit onReady: der Aufrufer steuert das Brett selbst über die chessground-API (Trainer).
 * - Ohne onReady: reine Anzeige von fen / lastMove / shapes.
 */
export function Board({ orientation = 'white', fen, lastMove, shapes, onReady, onMove, onShapes }) {
  const el = useRef(null);
  const api = useRef(null);
  const [, redraw] = useReducer(x => x + 1, 0);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const shapesRef = useRef(onShapes);
  shapesRef.current = onShapes;

  useEffect(() => {
    const pc = prefConfig();
    const cg = Chessground(el.current, {
      orientation,
      fen,
      viewOnly: !onReady,
      coordinates: false, // Koordinaten stehen immer außen am Rahmen (eigene Anzeige unten)
      animation: pc.animation,
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
      draggable: pc.draggable,
      selectable: pc.selectable,
      drawable: { onChange: s => shapesRef.current && shapesRef.current(s) },
      movable: {
        free: false,
        color: undefined,
        showDests: pc.movable.showDests,
        events: { after: (orig, dest) => moveRef.current && moveRef.current(orig, dest) },
      },
    });
    api.current = cg;
    el.current.__cg = cg; // für Tests im Browser
    const refresh = () => {
      if (api.current) {
        api.current.set(prefConfig());
      }
      redraw();
    };
    listeners.add(refresh);
    if (onReady) onReady(cg);
    return () => {
      listeners.delete(refresh);
      cg.destroy();
    };
  }, []);

  useEffect(() => {
    if (fen === undefined || !api.current) return;
    api.current.set({ fen, orientation, lastMove });
    api.current.setAutoShapes(shapes || []);
  }, [fen, orientation, shapes, lastMove]);

  // Zieh-Griff unten rechts: Brett größer/kleiner ziehen (gilt für alle Bretter, wird gespeichert)
  const startResize = ev => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const frame = ev.currentTarget.parentElement;
    const col = () => frame.closest('.editor-board') || frame; // im Editor gehört der Bewertungsbalken mit zur Spalte
    const w0 = col().getBoundingClientRect().width;
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    const root = document.documentElement;
    let raf = 0;
    root.classList.add('resizing');
    const move = e => {
      const w = Math.round(Math.min(1600, Math.max(280, w0 + (e.clientX - x0 + e.clientY - y0) / 2)));
      root.style.setProperty('--board-px', w + 'px');
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; document.body.dispatchEvent(new Event('chessground.resize')); });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      root.classList.remove('resizing');
      document.body.dispatchEvent(new Event('chessground.resize'));
      // gespeichert wird die Größe, die tatsächlich erreicht wurde (höchstens Fensterhöhe)
      const w = Math.round(col().getBoundingClientRect().width);
      root.style.setProperty('--board-px', w + 'px');
      if (boardPrefs.onResize) boardPrefs.onResize(w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const white = orientation === 'white';
  const files = (white ? 'abcdefgh' : 'hgfedcba').split('');
  const ranks = (white ? '87654321' : '12345678').split('');
  return html`<div class="board-wrap"><div class="board-frame">
    <div class="board" ref=${el}></div>
    <div class="coord-ranks" aria-hidden="true">${ranks.map(r => html`<span>${r}</span>`)}</div>
    <div class="coord-files" aria-hidden="true">${files.map(f => html`<span>${f}</span>`)}</div>
    ${onReady && html`<div class="board-resize" title="Ziehen, um das Brett größer oder kleiner zu machen" onPointerDown=${startResize}></div>`}
  </div></div>`;
}
