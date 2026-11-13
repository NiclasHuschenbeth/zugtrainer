import { html, useEffect, useMemo, useState } from 'preact';
import { germanName, loadOpenings, openingStats, variationOf } from '../lib/openings.js';

const MIN_GAMES = 5;
const pct = x => `${Math.round(x * 100)} %`;

function Bar({ e }) {
  return html`<span class="wdl-bar" title=${`${e.w} Siege · ${e.d} Remis · ${e.l} Niederlagen`}>
    <i class="w" style=${{ flexGrow: e.w }}></i><i class="d" style=${{ flexGrow: e.d }}></i><i class="l" style=${{ flexGrow: e.l }}></i>
  </span>`;
}

function Row({ e, label, open, onClick, sub }) {
  return html`<button class=${`stat-row ${sub ? 'sub' : ''} ${open ? 'open' : ''}`} onClick=${onClick} disabled=${!onClick}>
    <span class="grow stat-name">${label}</span>
    <span class="stat-n">${e.n}×</span>
    <${Bar} e=${e} />
    <b class=${`stat-score ${e.score >= 0.55 ? 'ok' : e.score < 0.45 ? 'bad' : ''}`}>${pct(e.score)}</b>
  </button>`;
}

/** Eröffnungsstatistik: gegen welche Eröffnungen läuft es gut, wo gibt es Probleme? */
export function StatsView({ games, color }) {
  const [map, setMap] = useState(null);
  const [openName, setOpenName] = useState(null);
  useEffect(() => {
    loadOpenings().then(setMap);
  }, []);
  const mine = useMemo(() => games.filter(g => g.userColor === color), [games, color]);
  const st = useMemo(() => (map ? openingStats(mine, map) : null), [map, mine]);

  if (!mine.length) return html`<div class="card center muted">Keine importierten Partien mit ${color === 'white' ? 'Weiß' : 'Schwarz'}.</div>`;
  if (!st) return html`<div class="card center muted">Lade Eröffnungsnamen …</div>`;

  const enough = st.list.filter(e => e.n >= MIN_GAMES);
  const weak = enough.filter(e => e.score < 0.45).sort((a, b) => a.score - b.score).slice(0, 5);
  const strong = enough.filter(e => e.score >= 0.55).sort((a, b) => b.score - a.score).slice(0, 5);

  return html`<div class="stack">
    <p class="muted small">Score = Siege plus halbe Remis, geteilt durch alle Partien. Probleme und Stärken werden erst ab ${MIN_GAMES} Partien einer Eröffnung gezeigt, damit Zufall nicht zählt.${st.unknown > 0 ? ` ${st.unknown} von ${mine.length} Partien konnten keiner Eröffnung zugeordnet werden.` : ''}</p>
    <div class="grid2">
      <div class="card">
        <h3 class="flat">Hier hast du Schwierigkeiten</h3>
        ${weak.length ? weak.map(e => html`<${Row} e=${e} label=${germanName(e.name)} />`) : html`<p class="muted small">Keine Eröffnung mit mindestens ${MIN_GAMES} Partien und einem Score unter 45 %.</p>`}
      </div>
      <div class="card">
        <h3 class="flat">Hier läuft es gut</h3>
        ${strong.length ? strong.map(e => html`<${Row} e=${e} label=${germanName(e.name)} />`) : html`<p class="muted small">Keine Eröffnung mit mindestens ${MIN_GAMES} Partien und einem Score ab 55 %.</p>`}
      </div>
    </div>
    <div class="card">
      <h3 class="flat">Alle Eröffnungen (${st.list.length})</h3>
      <div class="muted small">Klicke eine Eröffnung an, um die Varianten zu sehen.</div>
      <div class="stat-list">
        ${st.list.map(e => html`<${Row} e=${e} label=${germanName(e.name)} open=${openName === e.name} onClick=${() => setOpenName(openName === e.name ? null : e.name)} />
          ${openName === e.name && e.vars.map(v => html`<${Row} sub=${true} e=${v} label=${variationOf(v.name) || 'Grundlinie'} />`)}`)}
      </div>
    </div>
  </div>`;
}
