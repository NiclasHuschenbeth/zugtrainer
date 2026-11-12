import { html, useState } from 'preact';
import { fetchChessCom, fetchLichess, mergeGames, outcomeFor } from '../lib/games.js';

const SOURCES = {
  lichess: { title: 'Lichess', fetch: fetchLichess, placeholder: 'Lichess-Benutzername' },
  chesscom: { title: 'Chess.com', fetch: fetchChessCom, placeholder: 'Chess.com-Benutzername' },
};

export function GamesView({ db, update }) {
  const n = src => db.games.filter(g => g.source === src).length;
  return html`<div class="stack">
    <h1>Meine Partien</h1>
    <p class="muted">Gib deinen Benutzernamen ein – die Partien werden über die öffentlichen Schnittstellen von Lichess und Chess.com geladen. Ein Passwort ist nicht nötig, und alles bleibt in deinem Browser.</p>
    <div class="grid2">
      ${Object.keys(SOURCES).map(src => html`<${Importer} key=${src} src=${src} db=${db} update=${update} />`)}
    </div>
    <div class="card">
      <div class="row between">
        <h2>${db.games.length} Partien gespeichert</h2>
        ${db.games.length > 0 && html`<button class="link danger" onClick=${() => confirm('Alle importierten Partien löschen?') && update({ games: [] })}>Alle löschen</button>`}
      </div>
      <div class="muted small">${n('lichess')} von Lichess · ${n('chesscom')} von Chess.com</div>
      ${db.games.length > 0 && html`<table class="table">
        <thead><tr><th>Datum</th><th>Weiß</th><th>Schwarz</th><th>Ergebnis</th><th>Art</th><th></th></tr></thead>
        <tbody>
          ${db.games.slice(0, 15).map(g => html`<tr>
            <td>${new Date(g.date).toLocaleDateString('de-DE')}</td>
            <td class=${g.userColor === 'white' ? 'me' : ''}>${g.white}${g.whiteElo ? ` (${g.whiteElo})` : ''}</td>
            <td class=${g.userColor === 'black' ? 'me' : ''}>${g.black}${g.blackElo ? ` (${g.blackElo})` : ''}</td>
            <td><span class=${`res ${outcomeFor(g)}`}>${g.result.replace('1/2-1/2', '½-½')}</span></td>
            <td>${g.speed}</td>
            <td class="right"><a href=${g.url} target="_blank" rel="noopener">${g.source === 'lichess' ? 'Lichess' : 'Chess.com'} ↗</a></td>
          </tr>`)}
        </tbody>
      </table>`}
      ${db.games.length > 15 && html`<div class="muted small">… und ${db.games.length - 15} weitere</div>`}
    </div>
  </div>`;
}

function Importer({ src, db, update }) {
  const cfg = SOURCES[src];
  const [user, setUser] = useState(db.accounts[src] || '');
  const [max, setMax] = useState(100);
  const [state, setState] = useState({ busy: false, text: '', kind: '' });

  const run = async ev => {
    ev.preventDefault();
    if (!user.trim()) return;
    setState({ busy: true, text: 'Lade Partien …', kind: 'info' });
    try {
      const incoming = await cfg.fetch(user, max, count => setState({ busy: true, text: `${count} Partien geladen …`, kind: 'info' }));
      let added = 0;
      update(cur => {
        const m = mergeGames(cur.games, incoming);
        added = m.added;
        return { games: m.games, accounts: { ...cur.accounts, [src]: user.trim() } };
      });
      setState({ busy: false, text: `${incoming.length} Partien geladen, davon ${added} neu.`, kind: 'ok' });
    } catch (err) {
      const text = err instanceof TypeError ? 'Verbindung fehlgeschlagen – bitte Internetverbindung prüfen.' : err.message;
      setState({ busy: false, text, kind: 'bad' });
    }
  };

  return html`<form class="card" onSubmit=${run}>
    <h2>${cfg.title}</h2>
    <label>Benutzername
      <input type="text" value=${user} onInput=${e => setUser(e.target.value)} placeholder=${cfg.placeholder} autocomplete="off" spellcheck=${false} />
    </label>
    <label>Anzahl der letzten Partien
      <select value=${max} onChange=${e => setMax(+e.target.value)}>
        ${[50, 100, 200, 500, 1000].map(v => html`<option value=${v}>${v}</option>`)}
      </select>
    </label>
    <button class="btn primary" type="submit" disabled=${state.busy || !user.trim()}>${state.busy ? 'Lädt …' : 'Partien importieren'}</button>
    ${state.text && html`<div class=${`msg ${state.kind}`}>${state.text}</div>`}
  </form>`;
}
