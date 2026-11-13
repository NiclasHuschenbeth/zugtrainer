import { html, useEffect, useRef } from 'preact';
import { Chessground } from 'chessground';

/**
 * Brett auf Basis von Lichess' chessground.
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
    const cg = Chessground(el.current, {
      orientation,
      fen,
      viewOnly: !onReady,
      coordinates: true,
      animation: { duration: 220 },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
      drawable: { onChange: s => shapesRef.current && shapesRef.current(s) },
      movable: {
        free: false,
        color: undefined,
        showDests: true,
        events: { after: (orig, dest) => moveRef.current && moveRef.current(orig, dest) },
      },
    });
    api.current = cg;
    el.current.__cg = cg; // für Tests im Browser
    if (onReady) onReady(cg);
    return () => cg.destroy();
  }, []);

  useEffect(() => {
    if (fen === undefined || !api.current) return;
    api.current.set({ fen, orientation, lastMove });
    api.current.setAutoShapes(shapes || []);
  }, [fen, orientation, shapes, lastMove]);

  return html`<div class="board-wrap"><div class="board" ref=${el}></div></div>`;
}
