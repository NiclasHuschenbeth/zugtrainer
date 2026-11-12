import { html, useState } from 'preact';
import { parseRepertoirePgn } from '../lib/repertoire.js';
import { dayKey, lastDays, repStats, streakOf } from '../lib/srs.js';
import { SAMPLE_COLOR, SAMPLE_NAME, SAMPLE_PGN } from '../lib/sample.js';

function Today({ db, setGoal, train }) {
  const a = db.activity;
  const today = a.days[dayKey()] || 0;
  const streak = streakOf(a);
  const week = lastDays(a);
  const max = Math.max(a.goal, ...week.map(d => d.n));
  const dueByRep = db.repertoires.map(rep => ({ rep, due: repStats(rep, db.progress[rep.id] || {}).due }));
  const due = dueByRep.reduce((s, x) => s + x.due, 0);
  const next = dueByRep.filter(x => x.due).sort((x, y) => y.due - x.due)[0];
  const done = today >= a.goal;

  return html`<div class="card today">
    <div class="today-main">
      <div class="eyebrow">Heute</div>
      <div class="big">${today} <span class="muted">/ ${a.goal} Züge</span> ${done && html`<span class="ok">✓</span>`}</div>
      <div class="progress"><div style=${{ width: `${Math.min(100, (today / a.goal) * 100)}%` }}></div></div>
      <label class="inline small">Tagesziel
        <select value=${a.goal} onChange=${e => setGoal(+e.target.value)}>
          ${[10, 20, 30, 50, 100].map(v => html`<option value=${v}>${v} Züge</option>`)}
        </select>
      </label>
    </div>
    <div class="today-stat">
      <div class="eyebrow">Serie</div>
      <div class="big">${streak > 0 ? '🔥 ' : ''}${streak} <span class="muted">${streak === 1 ? 'Tag' : 'Tage'}</span></div>
      <div class="muted small">${done ? 'Tagesziel erreicht!' : streak > 0 ? 'Heute noch trainieren, um die Serie zu halten.' : 'Erreiche dein Tagesziel, um eine Serie zu starten.'}</div>
    </div>
    <div class="today-stat">
      <div class="eyebrow">Fällig</div>
      <div class="big">${due} <span class="muted">${due === 1 ? 'Zug' : 'Züge'}</span></div>
      ${next
        ? html`<button class="btn accent small" onClick=${() => train(next.rep.id, 'review')}>Jetzt wiederholen</button>`
        : html`<div class="muted small">Nichts zu wiederholen.</div>`}
    </div>
    <div class="week" title="Abgefragte Züge der letzten 7 Tage">
      ${week.map(d => html`<div class="day">
        <div class="bar"><div class=${d.n >= a.goal ? 'full' : ''} style=${{ height: `${(d.n / max) * 100}%` }}></div></div>
        <span>${d.label}</span>
      </div>`)}
    </div>
  </div>`;
}

export function RepertoiresView({ db, setGoal, addRepertoire, newRepertoire, removeRepertoire, train, edit, scrim }) {
  return html`<div class="stack">
    ${db.repertoires.length > 0 && html`<${Today} db=${db} setGoal=${setGoal} train=${train} />`}
    <${Upload} addRepertoire=${addRepertoire} newRepertoire=${newRepertoire} hasAny=${db.repertoires.length > 0} />
    ${db.repertoires.length === 0 && html`<p class="muted center">Noch kein Repertoire vorhanden. Lade eine PGN-Datei hoch oder probiere das Beispiel aus.</p>`}
    ${db.repertoires.map(rep => html`<${RepCard} key=${rep.id} rep=${rep} progress=${db.progress[rep.id] || {}} remove=${() => removeRepertoire(rep.id)} train=${train} edit=${() => edit(rep.id)} scrim=${() => scrim(rep.id)} />`)}
  </div>`;
}

function Upload({ addRepertoire, newRepertoire, hasAny }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('white');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(!hasAny);

  const submit = async ev => {
    ev.preventDefault();
    setError('');
    try {
      let pgn = text;
      for (const f of files) pgn += '\n\n' + (await f.text());
      if (!pgn.trim()) return setError('Bitte eine PGN-Datei auswählen oder PGN-Text einfügen.');
      const chapters = parseRepertoirePgn(pgn);
      if (!chapters.length) return setError('In der PGN wurden keine gültigen Züge gefunden.');
      const fallback = files[0] ? files[0].name.replace(/\.pgn$/i, '') : chapters[0].name;
      addRepertoire({ name: name.trim() || fallback, color, chapters });
      setName('');
      setText('');
      setFiles([]);
      ev.target.reset();
      setOpen(false);
    } catch (err) {
      setError('Die PGN konnte nicht gelesen werden: ' + err.message);
    }
  };

  const sample = () => {
    addRepertoire({ name: SAMPLE_NAME, color: SAMPLE_COLOR, chapters: parseRepertoirePgn(SAMPLE_PGN) });
    setOpen(false);
  };

  if (!open) {
    return html`<div class="row between">
      <h1>Meine Repertoires</h1>
      <button class="btn primary" onClick=${() => setOpen(true)}>+ Repertoire hochladen</button>
    </div>`;
  }

  return html`<form class="card" onSubmit=${submit}>
    <h2>Repertoire hochladen</h2>
    <p class="muted">PGN-Datei mit Varianten und Kommentaren, z. B. der Export einer Lichess-Studie oder aus ChessBase. Jede Partie in der Datei wird ein Kapitel, jede Variante eine Linie.</p>
    <div class="grid2">
      <label>Name
        <input type="text" value=${name} onInput=${e => setName(e.target.value)} placeholder="z. B. Sizilianisch Najdorf" />
      </label>
      <label>Ich spiele dieses Repertoire mit
        <select value=${color} onChange=${e => setColor(e.target.value)}>
          <option value="white">Weiß</option>
          <option value="black">Schwarz</option>
        </select>
      </label>
    </div>
    <label>PGN-Datei(en)
      <input type="file" accept=".pgn,text/plain" multiple onChange=${e => setFiles([...e.target.files])} />
    </label>
    <label>… oder PGN-Text einfügen
      <textarea rows="4" value=${text} onInput=${e => setText(e.target.value)} placeholder="1. e4 e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6 *"></textarea>
    </label>
    ${error && html`<div class="msg bad">${error}</div>`}
    <div class="row">
      <button class="btn primary" type="submit">Repertoire hinzufügen</button>
      <button class="btn" type="button" onClick=${() => newRepertoire(color)}>Leeres Repertoire im Editor anlegen</button>
      <button class="btn" type="button" onClick=${sample}>Beispiel-Repertoire laden</button>
      ${hasAny && html`<button class="btn ghost" type="button" onClick=${() => setOpen(false)}>Abbrechen</button>`}
    </div>
  </form>`;
}

function RepCard({ rep, progress, remove, train, edit, scrim }) {
  const [open, setOpen] = useState(false);
  const s = repStats(rep, progress);
  const fresh = s.total - s.learned;
  const pct = s.total ? Math.round((s.learned / s.total) * 100) : 0;

  return html`<div class="card">
    <div class="row between">
      <div>
        <h2>${rep.name}</h2>
        <div class="muted small">
          <span class=${`pill ${rep.color}`}>${rep.color === 'white' ? 'Weiß' : 'Schwarz'}</span>
          ${rep.chapters.length} Kapitel · ${s.lines} Linien · ${s.total} Züge
        </div>
      </div>
      <div class="row">
        <button class="btn primary" disabled=${!fresh} onClick=${() => train(rep.id, 'learn')}>Lernen${fresh ? ` (${fresh} neu)` : ''}</button>
        <button class=${`btn ${s.due ? 'accent' : ''}`} disabled=${!s.due} onClick=${() => train(rep.id, 'review')}>Wiederholen${s.due ? ` (${s.due})` : ''}</button>
        <button class="btn" disabled=${!s.total} onClick=${scrim} title="Repertoire gegen echte Gegnerzüge spielen">Testpartie</button>
        <button class="btn" onClick=${edit} title="Züge, Varianten und Kommentare bearbeiten, mit Engine und Datenbank">Editor / Analyse</button>
      </div>
    </div>
    <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
    <div class="row between small muted">
      <span>${s.learned} von ${s.total} Zügen gelernt (${pct} %)</span>
      <span>
        <button class="link" onClick=${() => setOpen(!open)}>${open ? 'Kapitel ausblenden' : 'Kapitel anzeigen'}</button>
        ${' · '}
        <button class="link" onClick=${edit}>Bearbeiten</button>
        ${' · '}
        <button class="link danger" onClick=${() => confirm(`Repertoire „${rep.name}“ samt Lernfortschritt löschen?`) && remove()}>Löschen</button>
      </span>
    </div>
    ${open && html`<table class="table">
      <thead><tr><th>Kapitel</th><th>Linien</th><th>Gelernt</th><th></th></tr></thead>
      <tbody>
        ${s.chapters.map((c, i) => html`<tr>
          <td>${c.name}</td>
          <td>${c.lines}</td>
          <td>${c.learned} / ${c.total}</td>
          <td class="right"><button class="btn small" disabled=${c.learned >= c.total} onClick=${() => train(rep.id, 'learn', i)}>Lernen</button></td>
        </tr>`)}
      </tbody>
    </table>`}
  </div>`;
}
