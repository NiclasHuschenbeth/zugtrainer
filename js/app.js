import { html, render, useEffect, useRef, useState } from 'preact';
import { INITIAL_FEN } from 'chessops/fen.js';
import { kvSet, loadAll } from './lib/storage.js';
import { dayKey, gradeCard } from './lib/srs.js';
import { positionVisits } from './lib/analysis.js';
import { finishLogin } from './lib/lichess.js';
import { RepertoireView, RepertoiresView } from './ui/repertoires.js';
import { Menu, MenuItem } from './ui/menu.js';
import { Trainer } from './ui/trainer.js';
import { GamesView } from './ui/games.js';
import { CompareView } from './ui/compare.js';
import { Editor } from './ui/editor.js';
import { Scrim } from './ui/scrim.js';
import { CONFIG } from './config.js';
import { AccountDialog } from './ui/account.js';
import { cloudEnabled, currentSession, deleteAccount, maySignedIn, onAuthChange, sendLoginLink, signOut, supabaseRemote, verifyCode } from './lib/cloud.js';
import { emptySync, runSync } from './lib/sync.js';

const SYNC_KEYS = ['repertoires', 'progress', 'activity', 'settings', 'sync'];

// Installations-Hinweis (Chrome/Android): Ereignis früh abfangen, die Oberfläche zeigt es später an
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('zt-install'));
});

function App() {
  const [db, setDb] = useState(null);
  const [view, setView] = useState({ name: 'home' });
  const dbRef = useRef(null);
  const [account, setAccountState] = useState(null);
  const accountRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | error | offline
  const [showAccount, setShowAccount] = useState(false);
  const syncing = useRef(false);
  const again = useRef(false);
  const timer = useRef(null);
  const watching = useRef(false);

  // patch: Objekt oder Funktion (aktueller Stand) => Objekt. opts.fromSync: Änderung stammt vom Abgleich selbst.
  const update = (p, opts = {}) => {
    const patch = typeof p === 'function' ? p(dbRef.current) : p;
    const next = { ...dbRef.current, ...patch };
    dbRef.current = next;
    for (const k of Object.keys(patch)) kvSet(k, next[k]).catch(err => console.error('Speichern fehlgeschlagen', err));
    setDb(next);
    if (!opts.fromSync && accountRef.current && SYNC_KEYS.some(k => k in patch)) scheduleSync();
  };

  const scheduleSync = (ms = 4000) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(doSync, ms);
  };

  /** Gleicht mit dem Konto ab. -> true bei Erfolg */
  const doSync = async () => {
    const acc = accountRef.current;
    if (!acc || !dbRef.current) return false;
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return false;
    }
    if (syncing.current) {
      again.current = true;
      return false;
    }
    syncing.current = true;
    setSyncStatus('syncing');
    let ok = false;
    try {
      const remote = await supabaseRemote(acc.userId);
      await runSync({ getDb: () => dbRef.current, update: fn => update(fn, { fromSync: true }), remote, userId: acc.userId });
      setSyncStatus('idle');
      ok = true;
    } catch (err) {
      console.error('Abgleich fehlgeschlagen', err);
      setSyncStatus('error');
    }
    syncing.current = false;
    if (again.current) {
      again.current = false;
      scheduleSync(500);
    }
    return ok;
  };

  const setAccount = s => {
    accountRef.current = s;
    setAccountState(s);
    if (!s) return;
    const d = dbRef.current;
    // Daten eines anderen Kontos liegen noch auf dem Gerät: nicht vermischen
    if (d && d.sync.userId && d.sync.userId !== s.userId) {
      update({ repertoires: [], progress: {}, activity: { goal: 20, days: {} }, sync: emptySync() }, { fromSync: true });
    }
    scheduleSync(300);
  };

  const watchAuth = async () => {
    if (watching.current) return;
    watching.current = true;
    await onAuthChange(setAccount);
  };

  useEffect(() => {
    const on = () => accountRef.current && scheduleSync(1000);
    const vis = () => document.visibilityState === 'visible' && accountRef.current && scheduleSync(1500);
    window.addEventListener('online', on);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('online', on);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const d = await loadAll();
      // Wer schon Repertoires hat, braucht die Einführung nicht mehr
      if (d.settings.onboarded === undefined) {
        d.settings = { ...d.settings, onboarded: d.repertoires.length > 0 };
        kvSet('settings', d.settings);
      }
      // Rückkehr von der Lichess-Anmeldung?
      const login = await finishLogin();
      if (login && login.token) {
        d.settings = { ...d.settings, lichessToken: login.token };
        kvSet('settings', d.settings);
      }
      dbRef.current = d;
      setDb(d);
      if (login && login.returnTo) setView(login.returnTo);
      if (maySignedIn()) {
        await watchAuth();
        const s = await currentSession().catch(() => null);
        if (s) setAccount(s);
      }
    })();
  }, []);

  const doDelete = async () => {
    if (!confirm('Dein Konto und alle im Konto gespeicherten Daten (Repertoires, Lernfortschritt, Einstellungen) werden unwiderruflich gelöscht. Die Daten auf diesem Gerät bleiben bestehen. Wirklich löschen?')) return;
    clearTimeout(timer.current);
    await deleteAccount();
    accountRef.current = null;
    setAccountState(null);
    update({ sync: emptySync() }, { fromSync: true });
    setSyncStatus('idle');
    setShowAccount(false);
  };

  const doSignOut = async () => {
    clearTimeout(timer.current);
    const ok = (await doSync()) || !accountRef.current;
    if (!ok && !confirm('Die letzten Änderungen konnten nicht mit deinem Konto abgeglichen werden und gehen beim Abmelden verloren. Trotzdem abmelden?')) return;
    await signOut();
    accountRef.current = null;
    setAccountState(null);
    update({ repertoires: [], progress: {}, activity: { goal: 20, days: {} }, sync: emptySync() }, { fromSync: true });
    setSyncStatus('idle');
    setView({ name: 'home' });
    setShowAccount(false);
  };

  if (!db) return html`<p class="loading">Lade Modern Chess Trainer …</p>`;

  const go = name => setView({ name });
  const setSettings = patch => update(cur => ({ settings: { ...cur.settings, ...patch, updatedAt: Date.now() } }));

  // Von der Repertoire-Seite aus gestartet? Dann führt "Zurück" wieder dorthin.
  const here = view.name === 'rep' ? { name: 'rep', repId: view.repId } : null;
  const back = () => setView(view.backTo || { name: 'home' });

  const train = (repId, mode, chapter = null, focusKey = null, backTo = undefined) => {
    const rep = db.repertoires.find(r => r.id === repId);
    const visits = mode === 'learn' && rep && db.games.length ? positionVisits(rep, db.games) : null;
    setView({ name: 'train', repId, mode, chapter, focusKey, visits, nonce: Date.now(), backTo: backTo === undefined ? here : backTo });
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
      return {
        repertoires: cur.repertoires.filter(r => r.id !== id),
        progress,
        sync: { ...cur.sync, tombstones: { ...cur.sync.tombstones, [id]: Date.now() } },
      };
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
      onExit=${() => (view.mode === 'practice' && !view.redo ? go('compare') : back())}
      redo=${view.redo}
      onPractice=${keys => setView({ ...view, mode: 'practice', focusKey: keys, chapter: null, redo: true, nonce: Date.now() })}
      onMore=${() => train(rep.id, view.mode, view.chapter, null, view.backTo)}
      onDone=${() => view.mode !== 'practice' && update(cur => ({ settings: { ...cur.settings, lessons: (cur.settings.lessons || 0) + 1 } }))}
    />`;
  } else if (view.name === 'edit' && rep) {
    body = html`<${Editor} key=${rep.id} rep=${rep} at=${view.at} focus=${view.focus} settings=${db.settings} setSettings=${setSettings} saveRep=${saveRep} onExit=${back} />`;
  } else if (view.name === 'scrim' && rep) {
    body = html`<${Scrim}
      key=${rep.id}
      rep=${rep}
      settings=${db.settings}
      setSettings=${setSettings}
      onGrade=${grade(rep.id, 'review')}
      onExit=${back}
      onEdit=${at => setView({ name: 'edit', repId: rep.id, at, backTo: view.backTo })}
    />`;
  } else if (view.name === 'rep' && rep) {
    body = html`<${RepertoireView}
      setSettings=${setSettings}
      db=${db}
      rep=${rep}
      train=${train}
      edit=${(id, focus) => setView({ name: 'edit', repId: id, focus, backTo: here })}
      scrim=${id => setView({ name: 'scrim', repId: id, backTo: here })}
      compare=${r => {
        setSettings({ compare: { ...db.settings.compare, [r.color]: r.id } });
        go('compare');
      }}
      remove=${() => {
        removeRepertoire(rep.id);
        go('home');
      }}
      back=${() => go('home')}
    />`;
  } else if (view.name === 'games') {
    body = html`<${GamesView} db=${db} update=${update} />`;
  } else if (view.name === 'compare') {
    body = html`<${CompareView} db=${db} go=${go} train=${train} setSettings=${setSettings} update=${update} />`;
  } else {
    body = html`<${RepertoiresView}
      db=${db}
      setGoal=${goal => update(cur => ({ activity: { ...cur.activity, goal, updatedAt: Date.now() } }))}
      setSettings=${setSettings}
      addRepertoire=${addRepertoire}
      newRepertoire=${newRepertoire}
      train=${train}
      open=${repId => setView({ name: 'rep', repId })}
    />`;
  }

  const isHome = ['home', 'rep', 'train', 'edit', 'scrim'].includes(view.name);
  const inTools = view.name === 'games' || view.name === 'compare';

  return html`
    <header class="top">
      <div class="brand" onClick=${() => go('home')} title="Modern Chess Trainer"><img src="icons/logo-wordmark-trainer.png" alt="Modern Chess Trainer" /></div>
      <nav>
        <button class=${isHome ? 'on' : ''} onClick=${() => go('home')}>Start</button>
        <${Menu} label="Werkzeuge" className=${inTools ? 'on' : ''}>
          <${MenuItem} title="Meine Partien auswerten" hint="Partien von Lichess und Chess.com laden und mit dem Repertoire abgleichen" onClick=${() => go('compare')} />
        <//>
      </nav>
      ${cloudEnabled() &&
      html`<button class=${`acct ${account ? 'in' : ''}`} onClick=${() => setShowAccount(true)} title=${account ? 'Dein Konto' : 'Anmelden, um auf allen Geräten zu lernen'}>
        ${account ? html`<span class=${`dot ${syncStatus}`}></span> Konto` : 'Anmelden'}
      </button>`}
    </header>
    ${showAccount &&
    html`<${AccountDialog}
      account=${account}
      status=${syncStatus}
      lastSync=${db.sync.last}
      onClose=${() => setShowAccount(false)}
      onSend=${async (email, captchaToken) => {
        await watchAuth();
        await sendLoginLink(email, captchaToken);
      }}
      onVerify=${async (email, code) => {
        await watchAuth();
        await verifyCode(email, code);
      }}
      onSyncNow=${() => doSync()}
      onSignOut=${doSignOut}
      onDelete=${doDelete}
    />`}
    <main class=${view.name === 'edit' ? 'wide' : ''}>${body}</main>
    <footer class="foot">
      Brett und Schachlogik: <a href="https://github.com/lichess-org/chessground" target="_blank" rel="noopener">chessground</a> und
      <a href="https://github.com/niklasf/chessops" target="_blank" rel="noopener">chessops</a> aus dem Lichess-Projekt,
      Engine: <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">Stockfish.js</a> (alle GPL-3.0).
      ${cloudEnabled() ? 'Ohne Konto bleiben alle Daten lokal in deinem Browser.' : 'Alle Daten bleiben lokal in deinem Browser.'}
      <div class="foot-links">
        ${CONFIG.sourceUrl && html`<a href=${CONFIG.sourceUrl} target="_blank" rel="noopener">Quellcode (GPL-3.0)</a>`}
        ${CONFIG.impressumUrl && html`<a href=${CONFIG.impressumUrl} target="_blank" rel="noopener">Impressum</a>`}
        ${CONFIG.datenschutzUrl && html`<a href=${CONFIG.datenschutzUrl} target="_blank" rel="noopener">Datenschutz</a>`}
      </div>
    </footer>`;
}

render(html`<${App} />`, document.getElementById('app'));
