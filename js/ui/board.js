import { html, useEffect, useRef } from 'preact';
import { Chessground } from 'chessground';

/** Brett-Einstellungen, die für alle Bretter gelten (kommen aus den Einstellungen des Nutzers). */
export const boardPrefs = { showDests: true, anim: true, input: 'both' };
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
      coordinates: false,
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
    const refresh = () => api.current && api.current.set(prefConfig());
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

  const white = orientation === 'white';
  const files = (white ? 'abcdefgh' : 'hgfedcba').split('');
  const ranks = (white ? '87654321' : '12345678').split('');
  return html`<div class="board-wrap"><div class="board-frame">
    <div class="board" ref=${el}></div>
    <div class="coord-ranks" aria-hidden="true">${ranks.map(r => html`<span>${r}</span>`)}</div>
    <div class="coord-files" aria-hidden="true">${files.map(f => html`<span>${f}</span>`)}</div>
  </div></div>`;
}
