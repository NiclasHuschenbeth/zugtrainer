import { html, useMemo, useState } from 'preact';
import { de } from '../lib/repertoire.js';
import { compare } from '../lib/analysis.js';
import { outcomeFor } from '../lib/games.js';
import { derived, epdOf, moveLabel } from '../lib/repertoire.js';
import { Board } from './board.js';
import { GamesView } from './games.js';
import { StatsView } from './stats.js';

const gameLink = (g, ply) => (g.source === 'lichess' ? `${g.url}${g.userColor === 'black' ? '/black' : ''}#${ply}` : g.url);
const opponent = g => (g.userColor === 'white' ? g.black : g.white);
const sans = list => list.map(e => de(e.san)).join(' oder ');

// Stellungen der Abweichungen (häufigste zuerst, jede Stellung nur einmal, max. 20).
// follow: wie viele eigene Folgezüge in der Repertoire-Linie zusätzlich abgefragt werden.
const FOLLOW = [[0, 'Nur der Abweichungszug'], [2, '+ 2 Folgezüge'], [4, '+ 4 Folgezüge'], [99, 'Bis zum Linienende']];
function drillKeys(rep, list, follow = 0) {
  const base = [...new Set(list.map(e => `${epdOf(e.fen)}|${e.expected[0].san}`))].slice(0, 20);
  if (!follow) return base;
  const { lines } = derived(rep);
  const out = new Set();
  for (const key of base) {
    out.add(key);
    const line = lines.find(l => l.keys.includes(key));
    if (!line) continue;
    let n = 0;
    for (let i = line.keys.indexOf(key) + 1; i < line.keys.length && n < follow; i++) {
      if (line.keys[i]) {
        out.add(line.keys[i]);
        n++;
      }
    }
  }
  return [...out];
}

const COLOR = { white: 'Weiß', black: 'Schwarz' };

export function CompareView({ db, go, train, setSettings, update }) {
  const s = db.settings;
  // Pro Farbe ein aktives Repertoire (gespeicherte Wahl, sonst das erste dieser Farbe)
  const active = color => {
    const mine = db.repertoires.filter(r => r.color === color);
    return mine.find(r => r.id === s.compare[color]) || mine[0] || null;
  };
  const reps = { white: active('white'), black: active('black') };
  const [side, setSide] = useState(reps.white ? 'white' : 'black');
  const [tab, setTab] = useState('you');
  const [sel, setSel] = useState(null);
  const rep = reps[side];
  const data = useMemo(() => (rep ? compare(rep, db.games) : null), [rep, db.games]);
  const gamesAs = color => db.games.filter(g => g.userColor === color).length;
  const choose = (color, id) => {
    setSettings({ compare: { ...s.compare, [color]: id } });
    setSel(null);
  };

  if (!db.repertoires.length) {
    return html`<div class="card center">
      <h2>Meine Partien auswerten</h2>
      <p class="muted">Dafür brauchst du zuerst mindestens ein Repertoire.</p>
      <div class="row center"><button class="btn primary" onClick=${() => go('home')}>Repertoire hochladen</button></div>
    </div>`;
  }
  if (!db.games.length) {
    return html`<div class="stack">
      <h1>Meine Partien auswerten</h1>
      <p class="muted">Schritt 1: Lade deine Partien. Danach siehst du hier sofort, wo du von deinem Repertoire abgewichen bist und welche Gegnerzüge dir noch fehlen.</p>
      <${GamesView} db=${db} update=${update} embedded=${true} />
    </div>`;
  }

  const picker = color => {
    const mine = db.repertoires.filter(r => r.color === color);
    return html`<label class=${`card pick ${side === color ? 'on' : ''}`} onClick=${() => { setSide(color); setSel(null); }}>
      <span><span class=${`pill ${color}`}>${COLOR[color]}</span> ${gamesAs(color)} Partien · abgleichen mit</span>
      ${mine.length
        ? html`<select value=${reps[color].id} onChange=${e => choose(color, e.target.value)}>
            ${mine.map(r => html`<option value=${r.id}>${r.name}</option>`)}
          </select>`
        : html`<span class="muted small">Noch kein ${COLOR[color]}-Repertoire hochgeladen.</span>`}
    </label>`;
  };

  const head = html`<h1>Meine Partien auswerten</h1>
    <p class="muted">Wo bist du in deinen Partien von deinem Repertoire abgewichen, und welche Gegnerzüge fehlen dir noch?</p>
    <p class="muted">Lege fest, welches Repertoire für deine Weiß- und welches für deine Schwarzpartien gilt. Klicke eine Farbe an, um deren Auswertung zu sehen.</p>
    <div class="grid2">${picker('white')}${picker('black')}</div>
    <details class="card load-games">
      <summary>${db.games.length} Partien geladen – weitere laden oder aktualisieren</summary>
      <${GamesView} db=${db} update=${update} embedded=${true} />
    </details>`;

  if (!rep) {
    return html`<div class="stack">${head}
      <div class="card center muted">Für ${COLOR[side]} ist noch kein Repertoire vorhanden.</div>
    </div>`;
  }

  const c = data.counts;
  const pct = n => (c.total ? Math.round((n / c.total) * 100) : 0);
  const list = tab === 'you' ? data.you : tab === 'opponent' ? data.opponent : null;
  const current = list && (list.find(e => e.key === sel) || list[0]);

  return html`<div class="stack">
    ${head}

    ${c.total === 0
      ? html`<div class="card center muted">Keine importierten Partien, in denen du ${rep.color === 'white' ? 'Weiß' : 'Schwarz'} hattest.</div>`
      : html`
        <div class="tiles">
          <div class="tile"><b>${c.total}</b><span>Partien mit ${rep.color === 'white' ? 'Weiß' : 'Schwarz'}</span></div>
          <div class="tile bad"><b>${c.you}</b><span>du bist abgewichen (${pct(c.you)} %)</span></div>
          <div class="tile warn"><b>${c.opponent}</b><span>Gegnerzug fehlt im Repertoire (${pct(c.opponent)} %)</span></div>
          <div class="tile ok"><b>${c.end}</b><span>Repertoire bis zum Ende gefolgt (${pct(c.end)} %)</span></div>
          <div class="tile"><b>${data.avgMoves.toFixed(1)}</b><span>Züge im Schnitt im Repertoire</span></div>
        </div>

        <div class="tabs">
          <button class=${tab === 'you' ? 'on' : ''} onClick=${() => { setTab('you'); setSel(null); }}>Deine Abweichungen (${data.you.length})</button>
          <button class=${tab === 'opponent' ? 'on' : ''} onClick=${() => { setTab('opponent'); setSel(null); }}>Lücken im Repertoire (${data.opponent.length})</button>
          <button class=${tab === 'games' ? 'on' : ''} onClick=${() => setTab('games')}>Alle Partien (${c.total})</button>
          <button class=${tab === 'stats' ? 'on' : ''} onClick=${() => setTab('stats')}>Eröffnungsstatistik</button>
        </div>

        ${tab === 'stats'
          ? html`<${StatsView} games=${db.games} color=${side} />`
          : tab === 'games'
          ? html`<${GameTable} rows=${data.rows} />`
          : !list.length
            ? html`<div class="card center muted">${tab === 'you' ? 'Stark – in diesen Partien bist du nie vom Repertoire abgewichen.' : 'Keine Lücken gefunden.'}</div>`
            : html`${tab === 'you' && html`<div class="row between card drill">
                  <span>Trainiere die Stellungen, in denen du vom Repertoire abgewichen bist – die häufigsten zuerst.
                    <select value=${s.drillFollow || 0} onChange=${e => setSettings({ drillFollow: +e.target.value })} aria-label="Wie viele Züge abfragen">
                      ${FOLLOW.map(([v, t]) => html`<option value=${v}>${t}</option>`)}
                    </select>
                  </span>
                  <button class="btn primary" onClick=${() => train(rep.id, 'practice', null, drillKeys(rep, list, s.drillFollow || 0))}>
                    Meine Abweichungen trainieren (${drillKeys(rep, list, s.drillFollow || 0).length} Stellungen)
                  </button>
                </div>`}
              <div class="compare">
                <div class="card list">
                  ${list.map(e => html`<button class=${`item ${current.key === e.key ? 'on' : ''}`} onClick=${() => setSel(e.key)}>
                    <span class="count">${e.rows.length}×</span>
                    <span class="grow">
                      <b>${moveLabel(e.fen)} ${de(e.played)}</b>
                      <span class="muted"> ${tab === 'you' ? 'statt' : '– im Repertoire nur'} ${sans(e.expected)}</span>
                    </span>
                    <span class="wdl"><i class="w">${e.w}</i><i class="d">${e.d}</i><i class="l">${e.l}</i></span>
                  </button>`)}
                </div>
                <${Detail} e=${current} rep=${rep} train=${train} />
              </div>`}
      `}
  </div>`;
}

function Detail({ e, rep, train }) {
  const shapes = useMemo(
    () => [
      ...e.expected.map(x => ({ orig: x.from, dest: x.to, brush: 'green' })),
      { orig: e.playedKeys[0], dest: e.playedKeys[1], brush: e.type === 'you' ? 'red' : 'yellow' },
    ],
    [e],
  );
  const label = moveLabel(e.fen);
  return html`<div class="card detail">
    <${Board} fen=${e.fen} orientation=${rep.color} shapes=${shapes} />
    ${e.type === 'you'
      ? html`<p>Du hast <b class="bad">${label} ${de(e.played)}</b> gespielt (roter Pfeil). Dein Repertoire sieht hier <b class="ok">${sans(e.expected)}</b> vor (grün).</p>`
      : html`<p>Dein Gegner spielte <b class="warn">${label} ${de(e.played)}</b> (gelber Pfeil). Dein Repertoire behandelt hier nur <b>${sans(e.expected)}</b> – diese Variante fehlt noch.</p>`}
    <p class="muted small">Bilanz in diesen Partien: ${e.w} Siege · ${e.d} Remis · ${e.l} Niederlagen</p>
    ${e.type === 'you' && html`<button class="btn primary" onClick=${() => train(rep.id, 'practice', null, `${epdOf(e.fen)}|${e.expected[0].san}`)}>Diese Linie üben</button>`}
    <h3>Partien</h3>
    <ul class="games">
      ${e.rows.slice(0, 10).map(({ game, res }) => html`<li>
        <span class=${`res ${outcomeFor(game)}`}>${game.result.replace('1/2-1/2', '½-½')}</span>
        <a href=${gameLink(game, res.ply)} target="_blank" rel="noopener">gegen ${opponent(game)} ↗</a>
        <span class="muted small">${new Date(game.date).toLocaleDateString('de-DE')} · ${game.speed}</span>
      </li>`)}
    </ul>
    ${e.rows.length > 10 && html`<div class="muted small">… und ${e.rows.length - 10} weitere</div>`}
  </div>`;
}

function verdict(res) {
  switch (res.type) {
    case 'you':
      return html`<span class="bad">Du: ${moveLabel(res.fen)} ${de(res.played)}</span> <span class="muted">statt ${sans(res.expected)}</span>`;
    case 'opponent':
      return html`<span class="warn">Gegner: ${moveLabel(res.fen)} ${de(res.played)}</span> <span class="muted">nicht im Repertoire</span>`;
    case 'end':
      return html`<span class="ok">Repertoire bis zum Ende gefolgt</span> <span class="muted">(${Math.ceil(res.ply / 2)} Züge)</span>`;
    case 'complete':
      return html`<span class="ok">Ganze Partie im Repertoire</span>`;
    default:
      return html`<span class="muted">Repertoire nicht erreicht</span>`;
  }
}

function GameTable({ rows }) {
  const [limit, setLimit] = useState(50);
  return html`<div class="card">
    <table class="table">
      <thead><tr><th>Datum</th><th>Gegner</th><th>Ergebnis</th><th>Erste Abweichung</th><th></th></tr></thead>
      <tbody>
        ${rows.slice(0, limit).map(({ game, res }) => html`<tr>
          <td>${new Date(game.date).toLocaleDateString('de-DE')}</td>
          <td>${opponent(game)}</td>
          <td><span class=${`res ${outcomeFor(game)}`}>${game.result.replace('1/2-1/2', '½-½')}</span></td>
          <td>${verdict(res)}</td>
          <td class="right"><a href=${gameLink(game, res.ply)} target="_blank" rel="noopener">Partie ↗</a></td>
        </tr>`)}
      </tbody>
    </table>
    ${rows.length > limit && html`<button class="btn small" onClick=${() => setLimit(limit + 100)}>Mehr anzeigen</button>`}
  </div>`;
}
