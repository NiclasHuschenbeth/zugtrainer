import { html, useEffect, useState } from 'preact';
import { fetchStudy, startLogin, studyIdOf } from '../lib/lichess.js';
import { derived, parseRepertoirePgn } from '../lib/repertoire.js';
import { chapterScope, dayKey, freshCount, hasPriority, keyScopeOf, keyStats, lastDays, lessonsOf, repStats, scopeChapters, scopeOf, streakOf } from '../lib/srs.js';
import { SAMPLE_COLOR, SAMPLE_NAME, SAMPLE_PGN } from '../lib/sample.js';
import { Menu, MenuDivider, MenuItem } from './menu.js';
import { InstallHint, Onboarding } from './onboarding.js';
import { RangeSlider, rangeLabel } from './rangeslider.js';
import { HomeReco } from './reco.js';
import { CoveragePanel } from './editor.js';
import { CONFIG } from '../config.js';

const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const KEY_FRESH = 10; // so viele neue Schlüsselstellungen pro Sitzung von der Startseite aus

/** Oben auf der Startseite: ein schmaler Streifen mit den Zahlen des Tages. */
function TodayStrip({ db, setGoal, train, onAdd }) {
  const a = db.activity;
  const today = a.days[dayKey()] || 0;
  const streak = streakOf(a);
  const stats = db.repertoires.map(rep => ({ rep, s: repStats(rep, db.progress[rep.id] || {}, !!db.settings.alts, scopeOf(db.settings, rep)) }));
  const due = stats.reduce((n, x) => n + x.s.due, 0);
  const next = stats.filter(x => x.s.due).sort((x, y) => y.s.due - x.s.due)[0];
  return html`<div class="card today">
    <div class="today-nums">
      <span><b>${due}</b> ${due === 1 ? 'Zug' : 'Züge'} fällig</span>
      <span class=${today >= a.goal ? 'done' : ''}>Tagesziel <b>${today}</b> von
        <select aria-label="Tagesziel" value=${a.goal} onChange=${e => setGoal(+e.target.value)}>
          ${[10, 20, 30, 50, 100].map(v => html`<option value=${v}>${v}</option>`)}
        </select>${today >= a.goal ? ' ✓' : ''}
      </span>
      <span>Serie <b>${streak}</b> ${streak === 1 ? 'Tag' : 'Tage'}</span>
    </div>
    <div class="row">
      ${next && html`<button class="btn primary" onClick=${() => train(next.rep.id, 'review')}>Jetzt wiederholen</button>`}
      <button class=${`btn ${next ? '' : 'primary'}`} onClick=${onAdd}>+ Repertoire hinzufügen</button>
    </div>
  </div>`;
}

function WeekMini({ activity }) {
  const week = lastDays(activity);
  const max = Math.max(activity.goal, ...week.map(d => d.n), 1);
  return html`<div class="week-mini" title="Abgefragte Züge der letzten 7 Tage">
    <span class="muted small">Letzte 7 Tage</span>
    ${week.map(d => html`<div class="day">
      <div class="bar"><div class=${d.n >= activity.goal ? 'full' : ''} style=${{ height: `${Math.max(d.n ? 12 : 0, (d.n / max) * 100)}%` }}></div></div>
      <span>${d.label}</span>
    </div>`)}
  </div>`;
}

const addSample = addRepertoire => addRepertoire({ name: SAMPLE_NAME, color: SAMPLE_COLOR, chapters: parseRepertoirePgn(SAMPLE_PGN) });

export function RepertoiresView({ db, setGoal, setSettings, addRepertoire, newRepertoire, train, open, go, account, openLogin }) {
  const [uploadOpen, setUploadOpen] = useState(() => !!pendingStudy());
  const reps = color => db.repertoires.filter(r => r.color === color);
  const hasProgress = Object.values(db.progress).some(p => Object.keys(p).length > 0);
  const onboarding = !db.settings.onboarded && !db.sync.last;
  if (onboarding) {
    const step = db.repertoires.length === 0 ? 1 : hasProgress ? 3 : 2;
    return html`<div class="stack">
      <${Onboarding} step=${step} rep=${db.repertoires[0]} train=${train} goal=${db.activity.goal} setGoal=${setGoal} finish=${() => setSettings({ onboarded: true })}
        account=${account} openLogin=${openLogin} sample=${() => addSample(addRepertoire)} upload=${() => setUploadOpen(!uploadOpen)} uploadOpen=${uploadOpen} shopUrl=${CONFIG.shopUrl} />
      ${step === 1 && uploadOpen && html`<${Upload} addRepertoire=${addRepertoire} newRepertoire=${newRepertoire} noSample=${true} token=${db.settings.lichessToken} />`}
    </div>`;
  }
  const showInstall = (db.settings.lessons || 0) >= 1 && !db.settings.installHint;
  const none = db.repertoires.length === 0;
  const group = (title, list) =>
    list.length > 0 &&
    html`<section class="stack tight">
      <h2 class="section">${title}</h2>
      <div class="card rep-list">${list.map(rep => html`<${RepRow} key=${rep.id} rep=${rep} db=${db} train=${train} open=${() => open(rep.id)} />`)}</div>
    </section>`;

  return html`<div class="stack">
    ${showInstall && html`<${InstallHint} dismiss=${() => setSettings({ installHint: 'dismissed' })} />`}
    ${!none && html`<${TodayStrip} db=${db} setGoal=${setGoal} train=${train} onAdd=${() => setUploadOpen(!uploadOpen)} />`}
    ${(uploadOpen || none) && html`<${Upload} addRepertoire=${addRepertoire} newRepertoire=${newRepertoire} onClose=${none ? null : () => setUploadOpen(false)} token=${db.settings.lichessToken} />`}
    ${none && html`<p class="muted center">Noch kein Repertoire vorhanden. Lade eine PGN-Datei hoch oder probiere das Beispiel aus.</p>`}
    ${none && openLogin && !account && html`<div class="card reco-hint">
      <span><b>Kurs gekauft?</b> Melde dich mit deiner Kauf-E-Mail an, dann erscheinen deine Kurse automatisch.</span>
      <button class="btn primary" onClick=${openLogin}>Anmelden</button>
    </div>`}
    <${HomeReco} db=${db} setSettings=${setSettings} go=${go} />
    ${group('Mit Weiß', reps('white'))}
    ${group('Mit Schwarz', reps('black'))}
    ${!none && html`<${WeekMini} activity=${db.activity} />`}
  </div>`;
}

const LOCK_TEXT = {
  revoked: 'Dein Zugang zu diesem Kurs ist beendet. Dein Lernfortschritt bleibt gespeichert.',
  signedout: 'Melde dich an, um diesen Kurs weiter zu nutzen. Dein Lernfortschritt bleibt gespeichert.',
};

/** Eine Zeile der Startseite: Name, Fortschritt, "wiederholen" und "Weiter lernen", darunter klein die Schlüsselstellungen. */
function RepRow({ rep, db, train, open }) {
  if (rep.lock) {
    return html`<div class="rep-row locked">
      <button class="rep-name" onClick=${open}><b>${rep.name}</b> <span class="chip lock">🔒 gesperrt</span></button>
      <div class="muted small rep-keys">${LOCK_TEXT[rep.lock]}</div>
    </div>`;
  }
  const st = db.settings;
  const progress = db.progress[rep.id] || {};
  const scope = scopeOf(st, rep);
  const s = repStats(rep, progress, !!st.alts, scope);
  const all = repStats(rep, progress, !!st.alts);
  const pct = pctOf(all.learned, all.total);
  const fresh = freshCount(rep, progress, st.depth || 0, !!st.alts, scope, st.from || 1, (st.ranges || {})[rep.id] || null);
  const ks = keyStats(rep, progress, keyScopeOf(st, rep));
  const kn = Math.min(KEY_FRESH, ks.fresh);
  return html`<div class="rep-row">
    <button class="rep-name" onClick=${open} title="Repertoire öffnen: Kapitel, Lernauswahl, Werkzeuge"><b>${rep.name}</b></button>
    <div class="rep-prog" title=${`${all.learned} von ${all.total} Zügen gelernt`}>
      <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
      <span class="muted small">${pct} %</span>
    </div>
    <div class="rep-actions">
      ${s.due > 0 && html`<button class="btn accent" onClick=${() => train(rep.id, 'review')}>${s.due} wiederholen</button>`}
      <button class=${`btn ${s.due ? '' : 'primary'}`} disabled=${!fresh} title=${fresh ? 'Neue Züge lernen, mit deiner Lernauswahl für dieses Repertoire' : 'In deiner Lernauswahl gibt es keine neuen Züge mehr'} onClick=${() => train(rep.id, 'learn')}>${fresh ? 'Weiter lernen' : 'Alles gelernt'}</button>
    </div>
    ${(ks.total > 0 || ks.due > 0) && html`<div class="muted small rep-keys">
      Schlüsselstellungen:${' '}
      ${ks.due
        ? html`<b>${ks.due} fällig</b> · <button class="link small" onClick=${() => train(rep.id, 'keys', null, 'due')}>üben</button>`
        : kn > 0
          ? html`${ks.fresh} neu · <button class="link small" onClick=${() => train(rep.id, 'keys', null, 'fresh')}>${kn} lernen</button>`
          : 'nichts fällig'}
    </div>`}
  </div>`;
}

/** Lernauswahl in Worten. */
function scopeText(rep, scope) {
  if (scope === 'prio') return 'Nur Prioritäten ★';
  if (scope === 'order') return 'Alles in der Reihenfolge des Kurses';
  if (scope.startsWith('lesson:')) return `Lektion: ${scope.slice(7)}`;
  if (scope.startsWith('ch:')) {
    const sc = scopeChapters(rep, scope);
    if (sc) return sc.size === 1 ? `1 Kapitel: ${rep.chapters[[...sc][0]].name}` : `${sc.size} von ${rep.chapters.length} Kapiteln`;
  }
  return hasPriority(rep) ? 'Alles (Prioritäten zuerst)' : 'Alles';
}

/** Fenster: einzelne Kapitel für das Lernen auswählen, nach Lektionen gruppiert. */
function ScopeDialog({ rep, scope, chapters, onSave, onClose }) {
  const lessons = lessonsOf(rep);
  const prio = hasPriority(rep);
  const [sel, setSel] = useState(() => scopeChapters(rep, scope) || new Set(rep.chapters.map((_, i) => i)));
  const [prioFirst, setPrioFirst] = useState(scope !== 'order');
  const groups = lessons.length
    ? [...lessons, ''].map(name => ({ name, items: chapters.filter(c => c.lesson === name) })).filter(g => g.items.length)
    : [{ name: '', items: chapters }];
  // Aufgeklappt sind anfangs nur Lektionen, in denen nicht alles oder nichts gewählt ist
  const [openSet, setOpenSet] = useState(() => new Set(groups.filter(g => g.items.some(c => sel.has(c.i)) && !g.items.every(c => sel.has(c.i))).map(g => g.name)));
  const toggle = (list, on) => {
    const n = new Set(sel);
    list.forEach(i => (on ? n.add(i) : n.delete(i)));
    setSel(n);
  };
  const flip = name => {
    const n = new Set(openSet);
    n.has(name) ? n.delete(name) : n.add(name);
    setOpenSet(n);
  };
  const allIdx = chapters.map(c => c.i);
  const save = () => onSave(sel.size === rep.chapters.length ? (prio && !prioFirst ? 'order' : 'all') : chapterScope(sel));
  const row = c => html`<label class="scope-ch" key=${c.i}>
    <input type="checkbox" checked=${sel.has(c.i)} onChange=${e => toggle([c.i], e.target.checked)} />
    <span class="grow">${c.priority && html`<span class="prio" title="Priorität">★</span> `}${c.name}</span>
    <span class="muted small">${c.learned} von ${c.total}</span>
  </label>`;

  return html`<div class="modal" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="modal-box scope-box" role="dialog" aria-label="Lernauswahl">
      <div class="row between">
        <h2 class="flat">Lernauswahl</h2>
        <button class="btn ghost small" onClick=${onClose}>Abbrechen</button>
      </div>
      <p class="muted small">Wähle, aus welchen Kapiteln neue Züge und neue Schlüsselstellungen kommen. Schon Gelerntes wird weiter wiederholt, egal was hier gewählt ist.</p>
      <div class="row">
        <button class="btn small" onClick=${() => setSel(new Set(allIdx))}>Alle</button>
        <button class="btn small" onClick=${() => setSel(new Set())}>Keine</button>
        ${prio && html`<button class="btn small" onClick=${() => setSel(new Set(chapters.filter(c => c.priority).map(c => c.i)))}>Nur ★</button>`}
        <span class="muted small">${sel.size} von ${rep.chapters.length} Kapiteln gewählt</span>
      </div>
      <div class="scope-list">
        ${groups.map(g => {
          if (!lessons.length) return g.items.map(row);
          const n = g.items.filter(c => sel.has(c.i)).length;
          const isOpen = openSet.has(g.name);
          return html`<div class="scope-lesson" key=${g.name}>
            <div class="scope-head">
              <input type="checkbox" aria-label=${`Lektion ${g.name || 'Weitere Kapitel'} ganz wählen`} checked=${n === g.items.length} indeterminate=${n > 0 && n < g.items.length}
                onChange=${e => toggle(g.items.map(c => c.i), e.target.checked)} />
              <button class="scope-toggle" aria-expanded=${isOpen} onClick=${() => flip(g.name)}>
                <span class="caret">${isOpen ? '▾' : '▸'}</span> <b>${g.name || 'Weitere Kapitel'}</b>
                <span class="muted small">${n} von ${g.items.length} Kapiteln</span>
              </button>
            </div>
            ${isOpen && html`<div class="scope-items">${g.items.map(row)}</div>`}
          </div>`;
        })}
      </div>
      ${prio && html`<label class="check"><input type="checkbox" checked=${prioFirst} disabled=${sel.size !== rep.chapters.length} onChange=${e => setPrioFirst(e.target.checked)} /> Prioritäten ★ zuerst lernen (sonst in der Reihenfolge des Kurses)</label>`}
      <div class="row">
        <button class="btn primary" disabled=${sel.size === 0} onClick=${save}>Fertig</button>
        ${sel.size === 0 && html`<span class="muted small">Wähle mindestens ein Kapitel.</span>`}
      </div>
    </div>
  </div>`;
}

/** Ein Repertoire: Kapitel mit Fortschritt, zwei Hauptknöpfe, Werkzeuge im Menü. */
export function RepertoireView(props) {
  const { rep, remove, back, openLogin } = props;
  if (!rep.lock) return html`<${OpenRepertoireView} ...${props} />`;
  return html`<div class="stack">
    <div><button class="link" onClick=${back}>← Alle Repertoires</button></div>
    <div class="card locked-card">
      <h1 class="rep-title">${rep.name} <span class="chip lock">🔒 gesperrt</span></h1>
      <p>${LOCK_TEXT[rep.lock]}</p>
      ${rep.lock === 'revoked' && html`<p class="muted small">Wenn du den Kurs wieder freischaltest, erscheint er hier von selbst, mit deinem bisherigen Lernstand.</p>`}
      <div class="row">
        ${rep.lock === 'signedout' && openLogin && html`<button class="btn primary" onClick=${openLogin}>Anmelden</button>`}
        ${rep.lock === 'revoked' && CONFIG.shopUrl && html`<a class="btn primary" href=${CONFIG.shopUrl} target="_blank" rel="noopener">Zum Shop ↗</a>`}
        ${rep.lock === 'revoked' &&
        html`<button class="btn" onClick=${() => confirm(`„${rep.name}“ aus der Liste entfernen? Der Lernfortschritt auf diesem Gerät wird dabei gelöscht.`) && remove()}>Aus der Liste entfernen</button>`}
      </div>
    </div>
  </div>`;
}

function OpenRepertoireView({ db, rep, train, setSettings, attachKeySolutions, edit, editAt, scrim, compare, remove, back }) {
  const scope = scopeOf(db.settings, rep);
  const lessons = lessonsOf(rep);
  const prio = hasPriority(rep);
  const s = repStats(rep, db.progress[rep.id] || {}, !!db.settings.alts, scope);
  const depth = db.settings.depth || 0;
  const from = db.settings.from || 1;
  const ranges = (db.settings.ranges || {})[rep.id] || {};
  const [openRange, setOpenRange] = useState(null);
  const [pick, setPick] = useState(false);
  const setRange = (i, f, t) => setSettings({ ranges: { ...(db.settings.ranges || {}), [rep.id]: { ...ranges, [i]: { from: f, to: t } } } });
  const clearRange = i => { const r = { ...ranges }; delete r[i]; setSettings({ ranges: { ...(db.settings.ranges || {}), [rep.id]: r } }); };
  const dd = derived(rep);
  const hasAlts = dd.mainKeys.size < dd.keys.size;
  const fresh = freshCount(rep, db.progress[rep.id] || {}, depth, !!db.settings.alts, scope, from, ranges);
  const keyScope = keyScopeOf(db.settings, rep);
  const kProg = db.progress[rep.id] || {};
  const ks = keyStats(rep, kProg, keyScope);
  const keyOptions = [
    { v: 'all', t: 'Alle Lektionen (gemischt)', n: keyStats(rep, kProg, null) },
    ...(prio ? [{ v: 'prio', t: 'Nur Prioritäten ★', n: keyStats(rep, kProg, 'prio') }] : []),
    ...lessons.map(l => ({ v: `lesson:${l}`, t: l, n: keyStats(rep, kProg, `lesson:${l}`) })),
    ...(keyScope.startsWith('ch:') ? [{ v: keyScope, t: 'Gewählte Kapitel (Lernauswahl)', n: keyStats(rep, kProg, keyScope) }] : []),
  ].filter(o => o.v === 'all' || o.v === keyScope || o.n.total > 0);
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
  // Die Lernauswahl gilt für neue Züge und für neue Schlüsselstellungen ('order' kennt die Schlüsselstellungs-Auswahl nicht)
  const setScope = v =>
    setSettings({ scopes: { ...(db.settings.scopes || {}), [rep.id]: v }, keyScopes: { ...(db.settings.keyScopes || {}), [rep.id]: v === 'order' ? 'all' : v } });
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
          <${MenuItem} title="Abdeckung prüfen" hint="Welche häufigen Gegnerzüge fehlen dir noch? (unten auf dieser Seite)" onClick=${() => { const el = document.getElementById('coverage-panel'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }} />
          ${ksAll.length > 0 && html`<${MenuItem} title="Lösungstexte laden" hint="Erklärungen zu den Schlüsselstellungen aus einer .json-Datei des Kurses" onClick=${pickSolutions} />`}
          <${MenuItem} title="Testpartie" hint="Dein Repertoire gegen echte Gegnerzüge spielen" onClick=${() => scrim(rep.id)} />
          <${MenuItem} title="Meine Partien auswerten" hint="Wo bist du in deinen Partien abgewichen?" onClick=${() => compare(rep)} />
          <${MenuDivider} />
          <${MenuItem} title="Repertoire löschen" danger=${true} onClick=${() => confirm(`Repertoire „${rep.name}“ samt Lernfortschritt löschen?`) && remove()} />
        <//>
      </div>
      <div class="progress"><div style=${{ width: `${pct}%` }}></div></div>
      <div class="muted small">${s.learned} von ${s.total} Zügen gelernt (${pct} %)</div>
      ${rep.chapters.length > 1 && html`<div class="scope-line">
        <span><span class="muted small">Lernauswahl</span> <b>${scopeText(rep, scope)}</b></span>
        <button class="btn small" onClick=${() => setPick(true)}>Lernauswahl ändern</button>
      </div>`}
      ${pick && html`<${ScopeDialog} rep=${rep} scope=${scope} chapters=${chapters} onClose=${() => setPick(false)} onSave=${v => { setScope(v); setPick(false); }} />`}
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
        ${keyOptions.length > 1 && html`<div class="muted small">Die Auswahl gilt für neue Stellungen. Schon geübte werden weiter wiederholt.</div>`}
      </div>`}
      <div class="depth">
        <div class="row between">
          <span class="small muted" title="Nur Züge in diesem Bereich werden neu abgefragt. Frühere Züge werden vorgespielt, spätere bleiben im Repertoire. Pro Kapitel lässt sich der Bereich einzeln ändern.">Zugbereich zum Lernen</span>
          <b class="depth-val">${rangeLabel(from, depth)}</b>
        </div>
        <${RangeSlider} from=${from} to=${depth} onChange=${(f, t) => setSettings({ from: f, depth: t })} />
        ${hasAlts && html`<label class="check alts" title="Aus: Es wird nur die Hauptvariante abgefragt (jeweils der erste Zug im PGN). Alternativen bleiben im Repertoire.">
          <input type="checkbox" checked=${!!db.settings.alts} onChange=${ev => setSettings({ alts: ev.target.checked })} /> Auch Alternativzüge trainieren
        </label>`}
      </div>
    </div>

    <div class="card">
      <h2>Kapitel</h2>
      ${prio && html`<p class="muted small prio-note"><span class="prio">★</span> = Priorität: besonders wichtige Varianten. Im Kurs sind sie mit „(P)“ markiert, beim Lernen kommen sie zuerst dran.</p>`}
      <div class="chapters">
        ${groups.map(g => html`${g.name !== '' || lessons.length > 0 ? html`<div class="lesson-head">${g.name || 'Weitere Kapitel'}
            <span class="muted small">${g.items.reduce((n, c) => n + c.learned, 0)} von ${g.items.reduce((n, c) => n + c.total, 0)} Zügen gelernt</span></div>` : null}
          ${g.items.map(c => html`<div class="chapter">
          <div class="grow">
            <b>${c.priority && html`<span class="prio" title="Priorität">★</span> `}${c.name}${ranges[c.i] && html`<span class="range-badge" title="Eigener Zugbereich für dieses Kapitel">${rangeLabel(ranges[c.i].from, ranges[c.i].to)}</span>`}</b>
            <div class="muted small">${c.lines} ${c.lines === 1 ? 'Linie' : 'Linien'} · ${c.learned} von ${c.total} Zügen gelernt</div>
            <div class="progress"><div style=${{ width: `${pctOf(c.learned, c.total)}%` }}></div></div>
          </div>
          <button class="btn small" disabled=${c.learned >= c.total} onClick=${() => train(rep.id, 'learn', c.i)}>Lernen</button>
          ${rep.videos && rep.videos[c.name] && html`<a class="btn ghost small" href=${rep.videos[c.name]} target="_blank" rel="noopener" title="Video zum Kapitel im Kurs ansehen">▶ Video</a>`}
          <button class="btn ghost small" onClick=${() => setOpenRange(openRange === c.i ? null : c.i)} title="Zugbereich nur für dieses Kapitel festlegen" aria-label="Zugbereich für dieses Kapitel">⚙</button>
        </div>
        ${openRange === c.i && html`<div class="chapter-range">
          <div class="row between"><span class="small muted">Zugbereich nur für dieses Kapitel</span><b class="depth-val">${ranges[c.i] ? rangeLabel(ranges[c.i].from, ranges[c.i].to) : `wie oben (${rangeLabel(from, depth)})`}</b></div>
          <${RangeSlider} from=${ranges[c.i] ? ranges[c.i].from : from} to=${ranges[c.i] ? ranges[c.i].to : depth} onChange=${(f, t) => setRange(c.i, f, t)} />
          ${ranges[c.i] && html`<button class="link small" onClick=${() => clearRange(c.i)}>Zurücksetzen auf den allgemeinen Bereich</button>`}
        </div>`}`)}`)}
      </div>
    </div>

    <${CoveragePanel} rep=${rep} settings=${db.settings} setSettings=${setSettings} onJump=${(ci, path) => editAt(rep.id, { ci, path })} />
  </div>`;
}

const STUDY_KEY = 'zt-study'; // Adresse der Studie, die nach der Lichess-Anmeldung weiter übernommen werden soll
const pendingStudy = () => {
  try {
    return sessionStorage.getItem(STUDY_KEY) || '';
  } catch {
    return '';
  }
};

/** Eine Lichess-Studie einmalig als Repertoire übernehmen: Adresse einfügen, Vorschau, Farbe wählen. */
function LichessImport({ addRepertoire, token, onDone }) {
  const [url, setUrl] = useState(pendingStudy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { text, auth }
  const [study, setStudy] = useState(null); // { id, name, color, chapters }

  const load = async address => {
    const id = studyIdOf(address);
    setStudy(null);
    if (!id) return setError({ text: 'Das sieht nicht nach der Adresse einer Lichess-Studie aus. Sie beginnt mit https://lichess.org/study/ …' });
    setBusy(true);
    setError(null);
    try {
      const s = await fetchStudy(id, token);
      const chapters = parseRepertoirePgn(s.pgn);
      if (!chapters.length) setError({ text: 'In dieser Studie stehen keine Züge.' });
      else setStudy({ id, name: s.name || 'Lichess-Studie', color: s.color, chapters });
    } catch (err) {
      setError({ text: err.message, auth: !!err.auth });
    }
    setBusy(false);
  };

  // Rückkehr von der Lichess-Anmeldung: gleich weitermachen
  useEffect(() => {
    const p = pendingStudy();
    if (!p) return;
    sessionStorage.removeItem(STUDY_KEY);
    if (token) load(p);
  }, []);

  const login = () => {
    try {
      sessionStorage.setItem(STUDY_KEY, url);
    } catch {
      // ohne Zwischenspeicher muss die Adresse nach der Anmeldung noch einmal eingefügt werden
    }
    startLogin({ name: 'home' }, 'study:read');
  };

  const take = () => {
    addRepertoire({ name: study.name, color: study.color, chapters: study.chapters, source: { lichessStudy: study.id } });
    setStudy(null);
    setUrl('');
    onDone();
  };

  return html`<div class="lichess-import stack tight">
    <label>Von Lichess übernehmen: Adresse der Studie
      <input type="text" inputmode="url" value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://lichess.org/study/AbCd1234"
        onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); load(url); } }} />
    </label>
    <div class="row">
      <button class="btn primary" type="button" disabled=${busy || !url.trim()} onClick=${() => load(url)}>${busy ? 'Hole Studie …' : 'Studie holen'}</button>
    </div>
    ${error && html`<div class="msg bad">
      ${error.text}
      ${error.auth && html`<p>Private Studien kann der Trainer nur lesen, wenn du es bei Lichess erlaubst.</p>
        <div class="row"><button class="btn" type="button" onClick=${login}>${token ? 'Neu bei Lichess anmelden' : 'Mit Lichess anmelden'}</button></div>`}
    </div>`}
    ${study && html`<div class="msg ok">
      <div><b>„${study.name}“</b> · ${study.chapters.length} Kapitel gefunden</div>
      <div class="row study-color">
        <span>Ich spiele mit:</span>
        ${['white', 'black'].map(c => html`<label class="check"><input type="radio" name="study-color" checked=${study.color === c} onChange=${() => setStudy({ ...study, color: c })} /> ${c === 'white' ? 'Weiß' : 'Schwarz'}</label>`)}
      </div>
      <div class="row"><button class="btn primary" type="button" onClick=${take}>Übernehmen</button></div>
      <p class="muted small">Das ist eine einmalige Kopie. Spätere Änderungen bei Lichess kommen nicht automatisch nach.</p>
    </div>`}
  </div>`;
}

function Upload({ addRepertoire, newRepertoire, noSample, token, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('white');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const setOpen = () => onClose && onClose();
  const [tab, setTab] = useState(() => (pendingStudy() ? 'lichess' : 'pgn')); // pgn | lichess | empty

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
    addSample(addRepertoire);
    setOpen(false);
  };

  const nameAndColor = html`<div class="grid2">
      <label>Name
        <input type="text" value=${name} onInput=${e => setName(e.target.value)} placeholder="z. B. Sizilianisch Najdorf" />
      </label>
      <label>Ich spiele dieses Repertoire mit
        <select value=${color} onChange=${e => setColor(e.target.value)}>
          <option value="white">Weiß</option>
          <option value="black">Schwarz</option>
        </select>
      </label>
    </div>`;

  return html`<div class="card">
    <div class="row between">
      <h2>Repertoire hinzufügen</h2>
      ${onClose && html`<button class="btn ghost small" type="button" onClick=${onClose}>Schließen</button>`}
    </div>
    <div class="tabs add-tabs" role="tablist">
      ${[['pgn', 'PGN-Datei'], ['lichess', 'Von Lichess'], ['empty', 'Leeres Repertoire']].map(
        ([k, t]) => html`<button type="button" role="tab" aria-selected=${tab === k} class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${t}</button>`,
      )}
    </div>
    ${tab === 'lichess' && html`<${LichessImport} addRepertoire=${addRepertoire} token=${token} onDone=${() => setOpen(false)} />`}
    ${tab === 'empty' && html`<div class="stack">
      <p class="muted">Legt ein leeres Repertoire an und öffnet den Editor. Dort gibst du die Züge selbst auf dem Brett ein.</p>
      ${nameAndColor}
      <div class="row"><button class="btn primary" type="button" onClick=${() => newRepertoire(color, name)}>Im Editor anlegen</button></div>
    </div>`}
    ${tab === 'pgn' && html`<form class="stack" onSubmit=${submit}>
    <p class="muted">PGN-Datei mit Varianten und Kommentaren, z. B. aus ChessBase oder der Export einer Lichess-Studie. Jede Partie in der Datei wird ein Kapitel, jede Variante eine Linie.</p>
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
      ${!noSample && html`<button class="btn" type="button" onClick=${sample}>Beispiel-Repertoire laden</button>`}
    </div>
  </form>`}
  </div>`;
}
