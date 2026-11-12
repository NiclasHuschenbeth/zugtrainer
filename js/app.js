import { html, render, useEffect, useRef, useState } from 'preact';
import { INITIAL_FEN } from 'chessops/fen.js';
import { kvSet, loadAll } from './lib/storage.js';
import { dayKey, gradeCard } from './lib/srs.js';
import { positionVisits } from './lib/analysis.js';
import { finishLogin } from './lib/lichess.js';
import { RepertoiresView } from './ui/repertoires.js';
import { Trainer } from './ui/trainer.js';
import { GamesView } from './ui/games.js';
import { CompareView } from './ui/compare.js';
import { Editor } from './ui/editor.js';
import { Scrim } from './ui/scrim.js';
import { CONFIG } from './config.js';

function App() {
  const [db, setDb] = useState(null);
  const [view, setView] = useState({ name: 'home' });
  const dbRef = useRef(null);

  useEffect(() => {
    (async () => {
      const d = await loadAll();
      // Rückkehr von der Lichess-Anmeldung?
      const login = await finishLogin();
      if (login && login.token) {
        d.settings = { ...d.settings, lichessToken: login.token };
        kvSet('settings', d.settings);
      }
      dbRef.current = d;
      setDb(d);
      if (login && login.returnTo) setView(login.returnTo);
    })();
  }, []);

  // patch: Objekt oder Funktion (aktueller Stand) => Objekt
  const update = p => {
    const patch = typeof p === 'function' ? p(dbRef.current) : p;
    const next = { ...dbRef.current, ...patch };
    dbRef.current = next;
    for (const k of Object.keys(patch)) kvSet(k, next[k]).catch(err => console.error('Speichern fehlgeschlagen', err));
    setDb(next);
  };

  if (!db) return html`<p class="loading">Lade Zugtrainer …</p>`;

  const go = name => setView({ name });
  const setSettings = patch => update(cur => ({ settings: { ...cur.settings, ...patch, updatedAt: Date.now() } }));

  const train = (repId, mode, chapter = null, focusKey = null) => {
    const rep = db.repertoires.find(r => r.id === repId);
    const visits = mode === 'learn' && rep && db.games.length ? positionVisits(rep, db.games) : null;
    setView({ name: 'train', repId, mode, chapter, focusKey, visits, nonce: Date.now() });
  };

  const addRepertoire = ({ name, color, chapters }) => {
    const id = crypto.randomUUID();
    update(cur => ({ repertoires: [...cur.repertoires, { id, name, color, chapters, createdAt: Date.now(), updatedAt: Date.now() }] }));
    return id;
  };

  const newRepertoire = color => {
    const id = addRepertoire({
      name: 'Neues Repertoire',
      color,
      chapters: [{ name: 'Kapitel 1', startFen: INITIAL_FEN, children: [] }],
    });
    setView({ name: 'edit', repId: id });
  };

  const saveRep = rep => update(cur => ({ repertoires: cur.repertoires.map(r => (r.id === rep.id ? { ...rep, updatedAt: Date.now() } : r)) }));

  const removeRepertoire = id =>
    update(cur => {
      const progress = { ...cur.progress };
      delete progress[id];
      return { repertoires: cur.repertoires.filter(r => r.id !== id), progress };
    });

  const grade = (repId, mode) => (key, ok) =>
    update(cur => {
      const mine = { ...(cur.progress[repId] || {}) };
      mine[key] = gradeCard(mine[key], ok, mode);
      const k = dayKey();
      const days = { ...cur.activity.days, [k]: (cur.activity.days[k] || 0) + 1 };
      return { progress: { ...cur.progress, [repId]: mine }, activity: { ...cur.activity, days } };
    });

  const rep = view.repId ? db.repertoires.find(r => r.id === view.repId) : null;
  let body;
  if (view.name === 'train' && rep) {
    body = html`<${Trainer}
      key=${view.nonce}
      rep=${rep}
      progress=${db.progress[rep.id] || {}}
      mode=${view.mode}
      chapter=${view.chapter}
      focusKey=${view.focusKey}
      visits=${view.visits}
      settings=${db.settings}
      setSettings=${setSettings}
      onGrade=${grade(rep.id, view.mode)}
      onExit=${() => go(view.mode === 'practice' ? 'compare' : 'home')}
      onMore=${() => train(rep.id, view.mode, view.chapter)}
    />`;
  } else if (view.name === 'edit' && rep) {
    body = html`<${Editor} key=${rep.id} rep=${rep} at=${view.at} settings=${db.settings} setSettings=${setSettings} saveRep=${saveRep} onExit=${() => go('home')} />`;
  } else if (view.name === 'scrim' && rep) {
    body = html`<${Scrim}
      key=${rep.id}
      rep=${rep}
      settings=${db.settings}
      setSettings=${setSettings}
      onGrade=${grade(rep.id, 'review')}
      onExit=${() => go('home')}
      onEdit=${at => setView({ name: 'edit', repId: rep.id, at })}
    />`;
  } else if (view.name === 'games') {
    body = html`<${GamesView} db=${db} update=${update} />`;
  } else if (view.name === 'compare') {
    body = html`<${CompareView} db=${db} go=${go} train=${train} setSettings=${setSettings} />`;
  } else {
    body = html`<${RepertoiresView}
      db=${db}
      setGoal=${goal => update(cur => ({ activity: { ...cur.activity, goal } }))}
      addRepertoire=${addRepertoire}
      newRepertoire=${newRepertoire}
      removeRepertoire=${removeRepertoire}
      train=${train}
      edit=${repId => setView({ name: 'edit', repId })}
      scrim=${repId => setView({ name: 'scrim', repId })}
    />`;
  }

  const isHome = n => n === 'home' || n === 'train' || n === 'edit' || n === 'scrim';
  const tab = (name, label) =>
    html`<button class=${view.name === name || (name === 'home' && isHome(view.name)) ? 'on' : ''} onClick=${() => go(name)}>${label}</button>`;

  return html`
    <header class="top">
      <div class="brand" onClick=${() => go('home')}>♞ Zugtrainer</div>
      <nav>${tab('home', 'Repertoires')}${tab('games', 'Partien')}${tab('compare', 'Abgleich')}</nav>
    </header>
    <main class=${view.name === 'edit' ? 'wide' : ''}>${body}</main>
    <footer class="foot">
      Brett und Schachlogik: <a href="https://github.com/lichess-org/chessground" target="_blank" rel="noopener">chessground</a> und
      <a href="https://github.com/niklasf/chessops" target="_blank" rel="noopener">chessops</a> aus dem Lichess-Projekt,
      Engine: <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">Stockfish.js</a> (alle GPL-3.0).
      Alle Daten bleiben lokal in deinem Browser.
      <div class="foot-links">
        ${CONFIG.sourceUrl && html`<a href=${CONFIG.sourceUrl} target="_blank" rel="noopener">Quellcode (GPL-3.0)</a>`}
        ${CONFIG.impressumUrl && html`<a href=${CONFIG.impressumUrl} target="_blank" rel="noopener">Impressum</a>`}
        ${CONFIG.datenschutzUrl && html`<a href=${CONFIG.datenschutzUrl} target="_blank" rel="noopener">Datenschutz</a>`}
      </div>
    </footer>`;
}

render(html`<${App} />`, document.getElementById('app'));
