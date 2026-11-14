import { html } from 'preact';

const MAX = 16; // Position 16 = "bis Ende" (Zug 15 und länger)

/** Text zum Zugbereich: from = erster Zug (1 = von Anfang an), to = letzter Zug (0 = bis Ende). */
export function rangeLabel(from, to) {
  if (from > 1 && to) return from === to ? `nur Zug ${from}` : `Zug ${from} bis ${to}`;
  if (from > 1) return `ab Zug ${from}`;
  if (to) return `bis Zug ${to}`;
  return 'alle Züge';
}

/** Ein Regler mit zwei Griffen: erster und letzter Zug, der abgefragt wird. */
export function RangeSlider({ from, to, onChange }) {
  const hi = to > 0 && to < MAX ? to : MAX;
  const pct = v => ((v - 1) / (MAX - 1)) * 100;
  const emit = (f, h) => onChange(f, h >= MAX ? 0 : h);
  return html`<div class="dual">
    <div class="dual-track"><div class="dual-fill" style=${{ left: `${pct(from)}%`, width: `${pct(hi) - pct(from)}%` }}></div></div>
    <input type="range" min="1" max=${MAX} step="1" value=${from} aria-label="Erster Zug, der abgefragt wird" aria-valuetext=${from > 1 ? `ab Zug ${from}` : 'von Anfang an'}
      style=${{ zIndex: from >= hi && from > 1 ? 5 : 3 }} onInput=${ev => emit(Math.min(+ev.target.value, hi), hi)} />
    <input type="range" min="1" max=${MAX} step="1" value=${hi} aria-label="Letzter Zug, der abgefragt wird" aria-valuetext=${hi < MAX ? `bis Zug ${hi}` : 'bis Ende'}
      style=${{ zIndex: 4 }} onInput=${ev => emit(from, Math.max(+ev.target.value, from))} />
  </div>
  <div class="depth-scale"><span>1</span><span>5</span><span>10</span><span>15+</span></div>`;
}
