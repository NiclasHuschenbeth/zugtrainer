import { html, useState } from 'preact';
import { parseRepertoirePgn } from '../lib/repertoire.js';
import { dayKey, lastDays, repStats, streakOf } from '../lib/srs.js';
import { SAMPLE_COLOR, SAMPLE_NAME, SAMPLE_PGN } from '../lib/sample.js';
import { Menu, MenuDivider, MenuItem } from './menu.js';
import { InstallHint, Onboarding } from './onboarding.js';

const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Tagesziel als Ring (Orange als Akzentfläche). */
function Ring({ value, max }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, max ? value / max : 0);
  return html`<svg class="ring" viewBox="0 0 90 90" role="img" aria-label=${`${value} von ${max} Zügen`}>
    <circle cx="45" cy="45" r=${r} fill="none" stroke="#E8EFF6" stroke-width="10" />
    ${p > 0 && html`<circle cx="45" cy="45" r=${r} fill="none" stroke="#F0AA64" stroke-width="10" stroke-linecap="round"
      stroke-dasharray=${`${c * p} ${c}`} transform="rotate(-90 45 45)" />`}
    <text x="45" y="52" text-anchor="middle" class="ring-n">${value}</text>
  </svg>`;
}

/** Oben auf der Startseite: Was ist heute fällig, Tagesziel, Serie. */
function Home({ db, setGoal, train }) {
  const a = db.activity;
  const today = a.days[dayKey()] || 0;
  const streak = streakOf(a);
  const week = lastDays(a);
  const max = Math.max(a.goal, ...week.map(d => d.n), 1);
  const done = today >= a.goal;
  const stats = db.repertoires.map(rep => ({ rep, s: repStats(rep, db.progress[rep.id] || {}) }));
  const due = stats.reduce((n, x) => n + x.s.due, 0);
  const dueReps = stats.filter(x => x.s.due);
  const next = [...dueReps].sort((x, y) => y.s.due - x.s.due)[0];
  const fresh = stats.find(x => x.s.total - x.s.learned > 0);

  return html`<div class="home-top">
    <div class="card hero">
      <div class="eyebrow">Heute fällig</div>
      <div class="hero-n">${due} <span>${due === 1 ? 'Zug' : 'Züge'}</span></div>
      <p class="muted">
        ${due
          ? dueReps.length > 1
            ? `aus ${dueReps.length} Repertoires`
            : `aus „${next.rep.name}“`
          : 'Heute ist nichts fällig. Nutze die Zeit für neue Züge.'}
      </p>
      ${due
        ? html`<button class="btn primary big" onClick=${() => train(next.rep.id, 'review')}>Jetzt wiederholen</button>`
        : fresh && html`<button class="btn primary big" onClick=${() => train(fresh.rep.id, 'learn')}>Neue Züge lernen</button>`}
    </div>

    <div class="card stat">
      <div class="eyebrow">Tagesziel</div>
      <${Ring} value=${today} max=${a.goal} />
      <div class="small">${done ? 'Geschafft!' : `von ${a.goal} Zügen`}</div>
      <label class="inline small">Ziel
        <select aria-label="Tagesziel" value=${a.goal} onChange=${e => setGoal(+e.target.value)}>
          ${[10, 20, 30, 50, 100].map(v => html`<option value=${v}>${v} Züge</option>`)}
        </select>
      </label>
    </div>

    <div class="card stat streak">
      <div class="eyebrow">Serie</div>
      <div class="big">${streak}</div>
      <div class="small">${streak === 1 ? 'Tag' : 'Tage'} in Folge</div>
      <div class="small hint">${done ? 'Tagesziel erreicht!' : streak > 0 ? 'Heute noch trainieren, um die Serie zu halten.' : 'Erreiche dein Tagesziel, um eine Serie zu starten.'}</div>
    </div>

    <div class="week-mini" title="Abgefragte Züge der letzten 7 Tage">
      <span class="muted small">Letzte 7 Tage</span>
      ${week.map(d => html`<div class="day">
        <div class="bar"><div class=${d.n >= a.goal ? 'full' : ''} style=${{ height: `${Math.max(d.n ? 12 : 0, (d.n / max) * 100)}%` }}></div></div>
        <span>${d.label}</span>
      </div>`)}
    </div>
  </div>`;
}

export function RepertoiresView({ db, setGoal, setSettings, addRepertoire, newRepertoire, train, open }) {
  const reps = color => db.repertoires.filter(r => r.color === color);
  const hasProgress = Object.values(db.progress).some(p => Object.keys(p).length > 0);
  const onboarding = !db.settings.onboarded && !db.sync.last;
  if (onboarding) {
    const step = db.repertoires.length === 0 ? 1 : hasProgress ? 3 : 2;
    return html`<div class="stack">
      <${Onboarding} step=${step} rep=${db.repertoires[0]} train=${train} goal=${db.activity.goal} setGoal=${setGoal} finish=${() => setSettings({ onboarded: true })} />
      ${step === 1 && html`<${Upload} addRepertoire=${addRepertoire} newRepertoire=${newRepertoire} hasAny=${false} />`}
    </div>`;
  }
  const showInstall = (db.settings.lessons || 0) >= 1 && !db.settings.installHint;
  const group = (title, list) =>
    list.length > 0 &&
    html`<section class="stack">
      <h2 class="section">${title}</h2>
      <div class="rep-grid">${list.map(rep => html`<${RepTile} key=${rep.id} rep=${rep} progress=${db.progress[rep.id] || {}} open=${() => open(rep.id)} />`)}</div>
    </section>`;

  return html`<div class="stack">
    ${showInstall && html`<${InstallHint} dismiss=${() => setSettings({ installHint: 'dismissed' })} />`}
    ${db.repertoires.length > 0 && html`<${Home} db=${db} setGoal=${setGoal} train=${train} />`}
    <${Upload} addRepertoire=${addRepertoire} newRepertoire=${newRepertoire} hasAny=${db.repertoires.length > 0} />
    ${db.repertoires.length === 0 && html`<p class="muted center">Noch kein Repertoire vorhanden. Lade eine PGN-Datei hoch oder probiere das Beispiel aus.</p>`}
    ${group('Repertoires mit Weiß', reps('white'))}
    ${group('Repertoires mit Schwarz', reps('black'))}
  </div>`;
}

function RepTile({ rep, progress, open }) {
  const s = repStats(rep, progress);
  const pct = pctOf(s.learned, s.total);
  return html`<button class="card tile" onClick=${open}>
    <div class="row between">
      <h3 class="flat">${rep.name}</h3>
      ${s.due > 0 && html`<span class="chip">${s.due} fällig</span>`}
    </div>
    <div class="muted small">${rep.chapters.length} Kapitel · ${s.lines} Linien · ${s.total} Züge</div>
    <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
    <div class="muted small">${s.learned} von ${s.total} Zügen gelernt (${pct} %)</div>
  </button>`;
}

/** Ein Repertoire: Kapitel mit Fortschritt, zwei Hauptknöpfe, Werkzeuge im Menü. */
export function RepertoireView({ db, rep, train, edit, scrim, compare, remove, back }) {
  const s = repStats(rep, db.progress[rep.id] || {});
  const fresh = s.total - s.learned;
  const pct = pctOf(s.learned, s.total);

  return html`<div class="stack">
    <div><button class="link" onClick=${back}>← Alle Repertoires</button></div>
    <div class="card">
      <div class="row between top-align">
        <div>
          <h1 class="rep-title">${rep.name}</h1>
          <div class="muted small">
            <span class=${`pill ${rep.color}`}>${rep.color === 'white' ? 'Weiß' : 'Schwarz'}</span>
            ${rep.chapters.length} Kapitel · ${s.lines} Linien · ${s.total} Züge
          </div>
        </div>
        <${Menu} label="Werkzeuge" className="btn" align="right">
          <${MenuItem} title="Editor" hint="Züge, Varianten und Kommentare bearbeiten" onClick=${() => edit(rep.id)} />
          <${MenuItem} title="Abdeckung prüfen" hint="Welche häufigen Gegnerzüge fehlen dir noch?" onClick=${() => edit(rep.id, 'coverage')} />
          <${MenuItem} title="Testpartie" hint="Dein Repertoire gegen echte Gegnerzüge spielen" onClick=${() => scrim(rep.id)} />
          <${MenuItem} title="Abgleich mit meinen Partien" hint="Wo bist du in deinen Partien abgewichen?" onClick=${() => compare(rep)} />
          <${MenuDivider} />
          <${MenuItem} title="Repertoire löschen" danger=${true} onClick=${() => confirm(`Repertoire „${rep.name}“ samt Lernfortschritt löschen?`) && remove()} />
        <//>
      </div>
      <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
      <div class="muted small">${s.learned} von ${s.total} Zügen gelernt (${pct} %)</div>
      <div class="row main-actions">
        <button class="btn primary big" disabled=${!fresh} onClick=${() => train(rep.id, 'learn')}>Neue Züge lernen${fresh ? ` (${fresh})` : ''}</button>
        <button class=${`btn big ${s.due ? 'accent' : ''}`} disabled=${!s.due} onClick=${() => train(rep.id, 'review')}>Wiederholen${s.due ? ` (${s.due})` : ''}</button>
      </div>
    </div>

    <div class="card">
      <h2>Kapitel</h2>
      <div class="chapters">
        ${s.chapters.map((c, i) => html`<div class="chapter">
          <div class="grow">
            <b>${c.name}</b>
            <div class="muted small">${c.lines} ${c.lines === 1 ? 'Linie' : 'Linien'} · ${c.learned} von ${c.total} Zügen gelernt</div>
            <div class="progress"><div style=${{ width: `${pctOf(c.learned, c.total)}%` }}></div></div>
          </div>
          <button class="btn small" disabled=${c.learned >= c.total} onClick=${() => train(rep.id, 'learn', i)}>Lernen</button>
        </div>`)}
      </div>
    </div>
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
