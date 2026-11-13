import { html, useState } from 'preact';
import { derived, parseRepertoirePgn } from '../lib/repertoire.js';
import { dayKey, freshCount, hasPriority, keyScopeOf, keyStats, lastDays, lessonsOf, repStats, scopeOf, streakOf } from '../lib/srs.js';
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
  const stats = db.repertoires.map(rep => ({ rep, s: repStats(rep, db.progress[rep.id] || {}, !!db.settings.alts, scopeOf(db.settings, rep)) }));
  const due = stats.reduce((n, x) => n + x.s.due, 0);
  const dueReps = stats.filter(x => x.s.due);
  const next = [...dueReps].sort((x, y) => y.s.due - x.s.due)[0];
  const fresh = stats.find(x => freshCount(x.rep, db.progress[x.rep.id] || {}, db.settings.depth || 0, !!db.settings.alts, scopeOf(db.settings, x.rep)) > 0);

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
      <div class="rep-grid">${list.map(rep => html`<${RepTile} key=${rep.id} rep=${rep} progress=${db.progress[rep.id] || {}} open=${() => open(rep.id)} alts=${!!db.settings.alts} />`)}</div>
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

function RepTile({ rep, progress, open, alts }) {
  const s = repStats(rep, progress, alts);
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
export function RepertoireView({ db, rep, train, setSettings, attachKeySolutions, edit, scrim, compare, remove, back }) {
  const scope = scopeOf(db.settings, rep);
  const lessons = lessonsOf(rep);
  const prio = hasPriority(rep);
  const s = repStats(rep, db.progress[rep.id] || {}, !!db.settings.alts, scope);
  const depth = db.settings.depth || 0;
  const dd = derived(rep);
  const hasAlts = dd.mainKeys.size < dd.keys.size;
  const fresh = freshCount(rep, db.progress[rep.id] || {}, depth, !!db.settings.alts, scope);
  const keyScope = keyScopeOf(db.settings, rep);
  const kProg = db.progress[rep.id] || {};
  const ks = keyStats(rep, kProg, keyScope);
  const keyOptions = [
    { v: 'all', t: 'Alle Lektionen (gemischt)', n: keyStats(rep, kProg, null) },
    ...(prio ? [{ v: 'prio', t: 'Nur Prioritäten ★', n: keyStats(rep, kProg, 'prio') }] : []),
    ...lessons.map(l => ({ v: `lesson:${l}`, t: l, n: keyStats(rep, kProg, `lesson:${l}`) })),
  ].filter(o => o.v === 'all' || o.n.total > 0);
  const ksAll = dd.keyPositions;
  const withText = ksAll.filter(k => k.solution).length;
  const pickSolutions = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const j = JSON.parse(await inp.files[0].text());
        if (!j.keySolutions) throw new Error('keine Lösungstexte');
        attachKeySolutions(rep.id, j.keySolutions);
      } catch {
        alert('Diese Datei enthält keine Lösungstexte für Schlüsselstellungen.');
      }
    };
    inp.click();
  };
  const setKeyScope = v => setSettings({ keyScopes: { ...(db.settings.keyScopes || {}), [rep.id]: v } });
  const chapters = s.chapters.map((c, i) => ({ ...c, i, lesson: rep.chapters[i].lesson || '', priority: !!rep.chapters[i].priority }));
  const groups = lessons.length
    ? [...lessons, ''].map(name => ({ name, items: chapters.filter(c => c.lesson === name) })).filter(g => g.items.length)
    : [{ name: '', items: chapters }];
  const setScope = v => setSettings({ scopes: { ...(db.settings.scopes || {}), [rep.id]: v } });
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
          ${ksAll.length > 0 && html`<${MenuItem} title="Lösungstexte laden" hint="Erklärungen zu den Schlüsselstellungen aus einer .json-Datei des Kurses" onClick=${pickSolutions} />`}
          <${MenuItem} title="Testpartie" hint="Dein Repertoire gegen echte Gegnerzüge spielen" onClick=${() => scrim(rep.id)} />
          <${MenuItem} title="Meine Partien auswerten" hint="Wo bist du in deinen Partien abgewichen?" onClick=${() => compare(rep)} />
          <${MenuDivider} />
          <${MenuItem} title="Repertoire löschen" danger=${true} onClick=${() => confirm(`Repertoire „${rep.name}“ samt Lernfortschritt löschen?`) && remove()} />
        <//>
      </div>
      <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
      <div class="muted small">${s.learned} von ${s.total} Zügen gelernt (${pct} %)</div>
      ${(lessons.length > 0 || prio) && html`<label class="scope">Lernauswahl
        <select value=${scope} onChange=${ev => setScope(ev.target.value)}>
          <option value="all">${prio ? 'Alles (Prioritäten zuerst)' : 'Alles'}</option>
          ${prio && html`<option value="order">Alles in PGN-Reihenfolge</option>`}
          ${prio && html`<option value="prio">Nur Prioritäten ★</option>`}
          ${lessons.map(l => html`<option value=${`lesson:${l}`}>Lektion: ${l}</option>`)}
        </select>
      </label>`}
      <div class="row main-actions">
        <button class="btn primary big" disabled=${!fresh} onClick=${() => train(rep.id, 'learn')}>Neue Züge lernen${fresh ? ` (${fresh})` : ''}</button>
        <button class=${`btn big ${s.due ? 'accent' : ''}`} disabled=${!s.due} onClick=${() => train(rep.id, 'review')}>Wiederholen${s.due ? ` (${s.due})` : ''}</button>
      </div>
      ${ks.total > 0 && html`<div class="keys-box">
        <div class="row between top-align">
          <div>
            <b>Schlüsselstellungen</b>
            <div class="muted small">${ks.total} in der Auswahl · ${ks.due} fällig · ${ks.fresh} neu${withText ? ` · ${withText} von ${ksAll.length} mit Erklärung` : ''}</div>
          </div>
          <button class="btn primary" disabled=${ks.due + ks.fresh === 0} onClick=${() => train(rep.id, 'keys')}>Üben</button>
        </div>
        <label class="small muted">Auswahl
          <select value=${keyScope} onChange=${ev => setKeyScope(ev.target.value)}>
            ${keyOptions.map(o => html`<option value=${o.v}>${o.t} (${o.n.total})</option>`)}
          </select>
        </label>
      </div>`}
      <div class="depth">
        <div class="row between">
          <label for="depth-range" class="small muted" title="Es werden nur Züge bis zu dieser Zugnummer neu abgefragt. Die übrigen Varianten bleiben im Repertoire.">Lerntiefe</label>
          <b class="depth-val">${depth ? `bis Zug ${depth}` : 'alle Züge (15+)'}</b>
        </div>
        <input id="depth-range" type="range" min="5" max="16" step="1" value=${depth || 16} aria-valuetext=${depth ? `bis Zug ${depth}` : 'alle Züge'}
          onInput=${ev => { const v = +ev.target.value; setSettings({ depth: v > 15 ? 0 : v }); }} />
        <div class="depth-scale"><span>5</span><span>10</span><span>15+</span></div>
        ${hasAlts && html`<label class="check alts" title="Aus: Es wird nur die Hauptvariante abgefragt (jeweils der erste Zug im PGN). Alternativen bleiben im Repertoire.">
          <input type="checkbox" checked=${!!db.settings.alts} onChange=${ev => setSettings({ alts: ev.target.checked })} /> Auch Alternativzüge trainieren
        </label>`}
      </div>
    </div>

    <div class="card">
      <h2>Kapitel</h2>
      <div class="chapters">
        ${groups.map(g => html`${g.name !== '' || lessons.length > 0 ? html`<div class="lesson-head">${g.name || 'Weitere Kapitel'}
            <span class="muted small">${g.items.reduce((n, c) => n + c.learned, 0)} von ${g.items.reduce((n, c) => n + c.total, 0)} Zügen gelernt</span></div>` : null}
          ${g.items.map(c => html`<div class="chapter">
          <div class="grow">
            <b>${c.priority && html`<span class="prio" title="Priorität">★</span> `}${c.name}</b>
            <div class="muted small">${c.lines} ${c.lines === 1 ? 'Linie' : 'Linien'} · ${c.learned} von ${c.total} Zügen gelernt</div>
            <div class="progress"><div style=${{ width: `${pctOf(c.learned, c.total)}%` }}></div></div>
          </div>
          ${rep.videos && rep.videos[c.name] && html`<a class="btn ghost small" href=${rep.videos[c.name]} target="_blank" rel="noopener" title="Video zum Kapitel im Kurs ansehen">▶ Video</a>`}
          <button class="btn small" disabled=${c.learned >= c.total} onClick=${() => train(rep.id, 'learn', c.i)}>Lernen</button>
        </div>`)}`)}
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
      let keySolutions = null;
      for (const f of files) {
        if (/\.json$/i.test(f.name)) {
          const j = JSON.parse(await f.text());
          if (j.keySolutions) keySolutions = j.keySolutions;
        } else pgn += '\n\n' + (await f.text());
      }
      if (!pgn.trim()) return setError('Bitte eine PGN-Datei auswählen oder PGN-Text einfügen.');
      const chapters = parseRepertoirePgn(pgn);
      if (!chapters.length) return setError('In der PGN wurden keine gültigen Züge gefunden.');
      const firstPgn = files.find(f => !/\.json$/i.test(f.name));
      const fallback = firstPgn ? firstPgn.name.replace(/\.pgn$/i, '') : chapters[0].name;
      addRepertoire({ name: name.trim() || fallback, color, chapters, ...(keySolutions ? { keySolutions } : {}) });
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
      <input type="file" accept=".pgn,.json,text/plain,application/json" multiple onChange=${e => setFiles([...e.target.files])} />
    </label>
    <p class="muted small">Zu einem Kurs gehört manchmal eine zweite Datei mit Lösungstexten für die Schlüsselstellungen (Endung .json). Wähle sie einfach zusammen mit der PGN aus.</p>
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
