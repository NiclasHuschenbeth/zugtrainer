import { html, render, useEffect, useRef, useState } from 'preact';
import { INITIAL_FEN } from 'chessops/fen.js';
import { kvSet, loadAll } from './lib/storage.js';
import { dayKey, gradeCard, keyStats } from './lib/srs.js';
import { positionVisits } from './lib/analysis.js';
import { finishLogin } from './lib/lichess.js';
import { RepertoireView, RepertoiresView } from './ui/repertoires.js';
import { Trainer } from './ui/trainer.js';
import { KeyTrainer } from './ui/keypos.js';
import { GamesView } from './ui/games.js';
import { CompareView } from './ui/compare.js';
import { Editor } from './ui/editor.js';
import { Scrim } from './ui/scrim.js';
import { setBoardPrefs } from './ui/board.js';
import { BoardSettings } from './ui/boardsettings.js';
import { CONFIG } from './config.js';
import { AccountDialog } from './ui/account.js';
import { cloudEnabled, currentSession, deleteAccount, fetchCourses, fetchCourseVersions, maySignedIn, onAuthChange, sendLoginLink, signOut, supabaseRemote, verifyCode } from './lib/cloud.js';
import { parseRepertoirePgn } from './lib/repertoire.js';
import { emptySync, isCourseId, runSync } from './lib/sync.js';

const SYNC_KEYS = ['repertoires', 'progress', 'activity', 'settings', 'sync'];

// Kurs-Aktualisierung: gleiche Kapitel in gleicher Reihenfolge? Sonst passen eigene Zugbereiche pro Kapitel nicht mehr.
const sameChapters = (a, b) => a.length === b.length && a.every((c, i) => c.name === b[i].name);
const dropRanges = (settings, ids) => {
  const ranges = { ...(settings.ranges || {}) };
  ids.forEach(id => delete ranges[id]);
  // Eine Auswahl einzelner Kapitel hängt ebenfalls an den Kapitelnummern
  const clean = map => Object.fromEntries(Object.entries(map || {}).filter(([id, v]) => !(ids.includes(id) && String(v).startsWith('ch:'))));
  return { ...settings, ranges, scopes: clean(settings.scopes), keyScopes: clean(settings.keyScopes), updatedAt: Date.now() };
};

// Installations-Hinweis (Chrome/Android): Ereignis früh abfangen, die Oberfläche zeigt es später an
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('zt-install'));
});

// Ansicht <-> Adresse (#/rep/<id>, #/train/<id>/learn/3, ...): "Zurück" und Neuladen führen zur selben Ansicht.
const viewToHash = v => {
  if (['rep', 'edit', 'scrim'].includes(v.name) && v.repId) return `#/${v.name}/${v.repId}`;
  if (v.name === 'train' && v.repId) return v.mode === 'practice' ? `#/rep/${v.repId}` : `#/train/${v.repId}/${v.mode}${v.chapter != null ? '/' + v.chapter : ''}`;
  if (v.name === 'games' || v.name === 'compare' || v.name === 'analyse') return `#/${v.name}`;
  return '#/';
};
const hashToView = h => {
  const [n, id, mode, ch] = h.replace(/^#\/?/, '').split('/');
  if (['rep', 'edit', 'scrim'].includes(n) && id) return { name: n, repId: id, ...(n === 'rep' ? {} : { backTo: { name: 'rep', repId: id } }) };
  if (n === 'train' && id && ['learn', 'review', 'keys'].includes(mode)) {
    return { name: 'train', repId: id, mode, chapter: ch !== undefined && ch !== '' ? +ch : null, focusKey: null, visits: null, nonce: Date.now(), backTo: { name: 'rep', repId: id } };
  }
  if (n === 'games' || n === 'compare' || n === 'analyse') return { name: n };
  return { name: 'home' };
};

function App() {
  const [db, setDb] = useState(null);
  const [view, setView] = useState({ name: 'home' });
  const dbRef = useRef(null);
  const [account, setAccountState] = useState(null);
  const accountRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | error | offline
  const [showAccount, setShowAccount] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [loginNote, setLoginNote] = useState(null); // Rückmeldung nach der Anmeldung: loading | found | none | error
  const firstLogin = useRef(false);
  const scratch = useRef({ id: 'analyse', name: 'Analyse', color: 'white', chapters: [{ name: 'Analyse', startFen: INITIAL_FEN, children: [] }] });
  const [courseNote, setCourseNote] = useState(null); // Namen gerade aktualisierter Kurse
  const [courseBusy, setCourseBusy] = useState(null);
  // Brett-Einstellungen auf die ganze Seite anwenden (Farben und Größe über CSS, Verhalten über board.js)
  const st = db && db.settings;
  useEffect(() => {
    if (!st) return;
    document.documentElement.dataset.board = st.boardTheme || 'modern';
    document.documentElement.dataset.bsize = String(st.boardSize || 3);
    setBoardPrefs({ showDests: st.showDests !== false, anim: st.anim !== false, input: st.moveInput || 'both', coords: st.coords || 'outside' });
  }, [st && st.boardTheme, st && st.boardSize, st && st.showDests, st && st.anim, st && st.moveInput, st && st.coords]);
  const syncing = useRef(false);
  const again = useRef(false);
  const timer = useRef(null);
  const watching = useRef(false);
  const routeReady = useRef(false);

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

  /**
   * Freigeschaltete Kurse (Ablefy) als Repertoire `course-<id>` auf diesem Gerät anlegen und aktuell halten.
   * Der Kursinhalt wird nicht ins Konto kopiert (siehe sync.js); abgeglichen werden nur der Lernfortschritt und
   * die Liste der vom Nutzer gelöschten Kurse (settings.coursesRemoved), damit sie nicht wiederkommen.
   */
  const preloadCourses = async () => {
    try {
      // Erst nur die Versionsnummern holen; den Kursinhalt (mehrere MB) nur für neue oder geänderte Kurse.
      // Deshalb gilt: jede Änderung an einem Kurs in der Datenbank braucht version + 1.
      const list = await fetchCourseVersions();
      const cur = dbRef.current;
      const removed = cur.settings.coursesRemoved || {};
      const oldSeen = cur.settings.coursesSeen || {}; // frühere Fassung: Versionsstand stand in den Einstellungen
      const localVersion = (r, courseId) => r.courseVersion || (typeof oldSeen[courseId] === 'number' ? oldSeen[courseId] : 1);
      const mineOf = courseId => cur.repertoires.find(r => r.id === 'course-' + courseId);
      // Kurse, die nicht mehr freigeschaltet sind (Erstattung, Entzug, Ablauf): Inhalt vom Gerät löschen, Lernstand bleibt.
      // Das passiert nur hier, also nur wenn der Server die Liste wirklich geliefert hat (nie bei Funkloch oder Fehler).
      const entitled = new Set(list.map(r => String(r.id)));
      const lost = cur.repertoires.filter(r => isCourseId(r.id) && !r.locked && !entitled.has(r.id.slice('course-'.length))).map(r => r.id);
      if (lost.length) {
        update(c => ({
          repertoires: c.repertoires.map(r =>
            lost.includes(r.id) ? { id: r.id, name: r.name, color: r.color, chapters: [], locked: true, courseVersion: 0, createdAt: r.createdAt, updatedAt: Date.now() } : r,
          ),
        }));
      }
      const need = list
        .filter(r => {
          if (removed[r.id]) return false;
          const mine = mineOf(r.id);
          return !mine || mine.locked || (r.version || 1) > localVersion(mine, r.id);
        })
        .map(r => r.id);
      const found = { count: list.length };
      if (!need.length) return found;
      const rows = await fetchCourses(need);
      const add = [];
      const back = {}; // wieder freigeschaltete Kurse: Inhalt neu anlegen, Lernstand ist noch da
      const updated = []; // Namen der Kurse, deren Inhalt gerade ausgetauscht wurde
      const reset = []; // Kurse, deren Kapitel sich verschoben haben: eigene Zugbereiche pro Kapitel passen nicht mehr
      const patch = {}; // Änderungen an schon vorhandenen Kurs-Repertoires (Struktur und Lernstand bleiben)
      for (const row of rows) {
        const id = 'course-' + row.id;
        const version = row.version || 1;
        const hasVideos = row.videos && Object.keys(row.videos).length > 0;
        const hasKeys = row.key_solutions && Object.keys(row.key_solutions).length > 0;
        const fresh = parseRepertoirePgn(String(row.pgn || '').replace(/^﻿/, ''));
        const mine = mineOf(row.id);
        if (!mine || mine.locked) {
          if (!fresh.length) continue;
          const entry = {
            id,
            name: row.name,
            color: row.color,
            chapters: fresh,
            ...(hasKeys ? { keySolutions: row.key_solutions } : {}),
            ...(hasVideos ? { videos: row.videos } : {}),
            courseVersion: version,
            pristine: true,
            createdAt: mine ? mine.createdAt : Date.now(),
            updatedAt: Date.now(),
          };
          if (mine) back[id] = entry;
          else add.push(entry);
          continue;
        }
        const p = { courseVersion: version };
        if (mine.pristine === true && fresh.length) {
          // Vom Nutzer nie bearbeitet: Inhalt austauschen. Der Lernstand hängt an Stellung und Zug und bleibt erhalten.
          if (!sameChapters(mine.chapters, fresh)) reset.push(id);
          p.chapters = fresh;
          updated.push(row.name || mine.name);
        } else {
          // Bearbeitet (oder unbekannt, weil älter als dieser Merker): nur Namen angleichen und die neue Fassung anbieten
          if (fresh.length === mine.chapters.length && fresh.some((c, i) => c.name !== mine.chapters[i].name)) {
            p.chapters = mine.chapters.map((c, i) => ({ ...c, name: fresh[i].name }));
          }
          if (fresh.length) p.updateAvailable = version;
        }
        if (hasVideos) p.videos = row.videos;
        if (row.color) p.color = row.color;
        if (hasKeys) p.keySolutions = row.key_solutions; // Lösungstexte kommen vom Kurs, nicht vom Nutzer
        patch[id] = p;
      }
      if (!add.length && !Object.keys(patch).length && !Object.keys(back).length) return found;
      update(c => {
        const have = new Set(c.repertoires.map(r => r.id));
        const fresh = add.filter(r => !have.has(r.id));
        return {
          repertoires: [...c.repertoires.map(r => (back[r.id] ? back[r.id] : patch[r.id] ? { ...r, ...patch[r.id], updatedAt: Date.now() } : r)), ...fresh],
          // Neu angelegte Kurse: den Lernfortschritt aus dem Konto beim nächsten Abgleich vollständig nachladen
          ...(fresh.length || Object.keys(back).length ? { sync: { ...c.sync, cardsPull: 0 } } : {}),
          ...(reset.length ? { settings: dropRanges(c.settings, reset) } : {}),
        };
      });
      if (updated.length) setCourseNote(updated);
      return found;
    } catch (err) {
      console.warn('Kurse konnten nicht geladen werden', err);
      return null;
    }
  };

  /** Nutzer nimmt die neue Fassung eines selbst bearbeiteten Kurses an (yes) oder behält seine eigene. */
  const answerCourseUpdate = async (id, yes) => {
    if (!yes) return update(c => ({ repertoires: c.repertoires.map(r => (r.id === id ? { ...r, updateAvailable: undefined } : r)) }));
    setCourseBusy(id);
    try {
      const [row] = await fetchCourses([id.slice('course-'.length)]);
      const fresh = row ? parseRepertoirePgn(String(row.pgn || '').replace(/^\uFEFF/, '')) : [];
      if (!fresh.length) throw new Error('leer');
      update(c => {
        const mine = c.repertoires.find(r => r.id === id);
        if (!mine) return {};
        const next = { ...mine, chapters: fresh, courseVersion: row.version || 1, pristine: true, updateAvailable: undefined, updatedAt: Date.now() };
        if (row.key_solutions && Object.keys(row.key_solutions).length) next.keySolutions = row.key_solutions;
        if (row.videos && Object.keys(row.videos).length) next.videos = row.videos;
        return {
          repertoires: c.repertoires.map(r => (r.id === id ? next : r)),
          ...(sameChapters(mine.chapters, fresh) ? {} : { settings: dropRanges(c.settings, [id]) }),
        };
      });
      setCourseNote([row.name]);
    } catch (err) {
      console.warn('Kurs konnte nicht aktualisiert werden', err);
      alert('Die neue Fassung konnte gerade nicht geladen werden. Bitte später noch einmal versuchen.');
    }
    setCourseBusy(null);
  };

  /** Nach der ersten Anmeldung auf diesem Gerät: sagen, welche Kurse gefunden wurden (oder dass keiner da ist). */
  const reportLogin = (acc, found) => {
    if (!firstLogin.current) return;
    if (!found) return setLoginNote({ kind: 'error' });
    firstLogin.current = false;
    const names = dbRef.current.repertoires.filter(r => isCourseId(r.id) && !r.locked).map(r => r.name);
    if (!found.count) setLoginNote({ kind: 'none', email: acc.email });
    else setLoginNote(names.length ? { kind: 'found', names } : null);
  };

  /** Gleicht mit dem Konto ab. -> true bei Erfolg */
  const doSync = async () => {
    const acc = accountRef.current;
    if (!acc || !dbRef.current) return false;
    if (!navigator.onLine) {
      setSyncStatus('offline');
      reportLogin(acc, null);
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
      reportLogin(acc, await preloadCourses());
    } catch (err) {
      console.error('Abgleich fehlgeschlagen', err);
      setSyncStatus('error');
      reportLogin(acc, null);
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
    // Erste Anmeldung mit diesem Konto auf diesem Gerät: gleich zeigen, dass die Kurse geholt werden
    if (d && d.sync.userId !== s.userId && !firstLogin.current) {
      firstLogin.current = true;
      setLoginNote({ kind: 'loading' });
    }
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
      else if (/^#\//.test(location.hash)) {
        const v = hashToView(location.hash);
        if (v.name !== 'home') setView(v);
      }
      routeReady.current = true;
      if (maySignedIn()) {
        await watchAuth();
        const s = await currentSession().catch(() => null);
        if (s) setAccount(s);
      }
    })();
  }, []);

  // Neue Ansicht: immer oben beginnen (sonst bleibt die Scrollposition der vorigen Seite stehen)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.name, view.repId, view.mode, view.chapter]);

  // Jede neue Ansicht bekommt einen Eintrag im Browserverlauf
  useEffect(() => {
    if (!routeReady.current) return;
    const h = viewToHash(view);
    if (h !== (location.hash || '#/')) history.pushState(null, '', h);
  }, [view]);

  useEffect(() => {
    const on = () => {
      const h = location.hash;
      if (h && !/^#\//.test(h)) return; // z. B. Anmelde-Antworten bleiben unberührt
      setView(hashToView(h || '#/'));
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
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
    firstLogin.current = false;
    setLoginNote(null);
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

  // source: Herkunft, z. B. { lichessStudy: '<Kennung>' } (für ein späteres "Neu von Lichess holen")
  const addRepertoire = ({ name, color, chapters, keySolutions, source }) => {
    const id = crypto.randomUUID();
    update(cur => ({
      repertoires: [...cur.repertoires, { id, name, color, chapters, ...(keySolutions ? { keySolutions } : {}), ...(source ? { source } : {}), createdAt: Date.now(), updatedAt: Date.now() }],
    }));
    return id;
  };

  const attachKeySolutions = (repId, keySolutions) =>
    update(cur => ({ repertoires: cur.repertoires.map(r => (r.id === repId ? { ...r, keySolutions, updatedAt: Date.now() } : r)) }));

  const newRepertoire = (color, name) => {
    const id = addRepertoire({
      name: (name || '').trim() || 'Neues Repertoire',
      color,
      chapters: [{ name: 'Kapitel 1', startFen: INITIAL_FEN, children: [] }],
    });
    setView({ name: 'edit', repId: id });
  };

  // Kurse: merken, dass der Nutzer den Inhalt selbst verändert hat (dann wird vor einer Kurs-Aktualisierung gefragt)
  const saveRep = rep =>
    update(cur => ({ repertoires: cur.repertoires.map(r => (r.id === rep.id ? { ...rep, ...(isCourseId(rep.id) ? { pristine: false } : {}), updatedAt: Date.now() } : r)) }));

  const removeRepertoire = id =>
    update(cur => {
      const progress = { ...cur.progress };
      delete progress[id];
      // Gelöschter Kurs: merken, damit er auf keinem Gerät wieder angelegt wird (wird mit den Einstellungen abgeglichen)
      if (isCourseId(id) && !(cur.repertoires.find(r => r.id === id) || {}).locked) {
        const coursesRemoved = { ...(cur.settings.coursesRemoved || {}), [id.slice('course-'.length)]: true };
        return { repertoires: cur.repertoires.filter(r => r.id !== id), progress, settings: { ...cur.settings, coursesRemoved, updatedAt: Date.now() } };
      }
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

  // Gesperrte Kurse: 'revoked' = Zugang beendet (Inhalt ist schon vom Gerät gelöscht), 'signedout' = nicht angemeldet.
  // Für die Oberfläche bekommen sie leere Kapitel; an den gespeicherten Daten ändert das nichts.
  const signedIn = !!account || maySignedIn();
  const lockOf = r => (isCourseId(r.id) ? (r.locked ? 'revoked' : signedIn ? null : 'signedout') : null);
  const vdb = db.repertoires.some(lockOf)
    ? { ...db, repertoires: db.repertoires.map(r => (lockOf(r) ? { ...r, chapters: [], keySolutions: undefined, videos: undefined, lock: lockOf(r) } : r)) }
    : db;
  const rep = view.repId ? vdb.repertoires.find(r => r.id === view.repId) : null;
  // Lernen, Editor und Testpartie gibt es für gesperrte Kurse nicht: stattdessen die Kursseite mit dem Hinweis
  const vname = rep && rep.lock && ['train', 'edit', 'scrim'].includes(view.name) ? 'rep' : view.name;
  let body;
  if (vname === 'train' && rep && view.mode === 'keys') {
    // Von der Startseite gestartet (nur fällige): am Ende den nächsten Kurs mit fälligen Stellungen anbieten
    const only = view.focusKey === 'due' || view.focusKey === 'fresh' ? view.focusKey : null;
    const other =
      only === 'due' &&
      db.repertoires
        .filter(r => r.id !== rep.id)
        .map(r => ({ r, due: keyStats(r, db.progress[r.id] || {}).due }))
        .filter(x => x.due > 0)
        .sort((a, b) => b.due - a.due)[0];
    body = html`<${KeyTrainer}
      only=${only}
      next=${other ? { name: other.r.name, due: other.due, go: () => train(other.r.id, 'keys', null, 'due', view.backTo) } : null}
      key=${view.nonce}
      rep=${rep}
      progress=${db.progress[rep.id] || {}}
      settings=${db.settings}
      setSettings=${setSettings}
      onGrade=${grade(rep.id, 'review')}
      onExit=${back}
      onMore=${() => train(rep.id, 'keys', null, null, view.backTo)}
    />`;
  } else if (vname === 'train' && rep) {
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
  } else if (vname === 'edit' && rep) {
    body = html`<${Editor} key=${rep.id} rep=${rep} at=${view.at} focus=${view.focus} settings=${db.settings} setSettings=${setSettings} saveRep=${saveRep} onExit=${back} />`;
  } else if (view.name === 'analyse') {
    // Freies Analysebrett: der Editor auf einem Notizblock, der nur bis zum Neuladen der Seite bleibt (nichts wird gespeichert)
    body = html`<${Editor} key="analyse" rep=${scratch.current} settings=${db.settings} setSettings=${setSettings} saveRep=${r => (scratch.current = r)} onExit=${() => go('home')} free=${true} />`;
  } else if (vname === 'scrim' && rep) {
    body = html`<${Scrim}
      key=${rep.id}
      rep=${rep}
      settings=${db.settings}
      setSettings=${setSettings}
      onGrade=${grade(rep.id, 'review')}
      onExit=${back}
      onEdit=${at => setView({ name: 'edit', repId: rep.id, at, backTo: view.backTo })}
    />`;
  } else if (vname === 'rep' && rep) {
    body = html`<${RepertoireView}
      setSettings=${setSettings}
      attachKeySolutions=${attachKeySolutions}
      db=${vdb}
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
      openLogin=${cloudEnabled() ? () => setShowAccount(true) : null}
    />`;
  } else if (view.name === 'games') {
    body = html`<${GamesView} db=${db} update=${update} />`;
  } else if (view.name === 'compare') {
    body = html`<${CompareView} db=${vdb} go=${go} train=${train} setSettings=${setSettings} update=${update} openRep=${id => setView({ name: 'rep', repId: id })} />`;
  } else {
    body = html`<${RepertoiresView}
      db=${vdb}
      setGoal=${goal => update(cur => ({ activity: { ...cur.activity, goal, updatedAt: Date.now() } }))}
      setSettings=${setSettings}
      addRepertoire=${addRepertoire}
      newRepertoire=${newRepertoire}
      train=${train}
      open=${repId => setView({ name: 'rep', repId })}
      go=${go}
      account=${account}
      openLogin=${cloudEnabled() ? () => setShowAccount(true) : null}
    />`;
  }

  const isHome = ['home', 'rep', 'train', 'edit', 'scrim'].includes(view.name);
  const inTools = view.name === 'games' || view.name === 'compare';

  // Beim Lernen und in der Testpartie bleibt auf kleinen Bildschirmen nur eine schmale Kopfzeile (mehr Platz fürs Brett)
  const slim = view.name === 'train' || view.name === 'scrim';
  const note =
    loginNote &&
    html`<div class=${`login-note ${loginNote.kind}`} role="status">
      ${loginNote.kind === 'loading' && html`<span>Du bist angemeldet. Deine Kurse werden geladen …</span>`}
      ${loginNote.kind === 'found' &&
      html`<span><b>✓ ${loginNote.names.length === 1 ? 'Dein Kurs ist' : `${loginNote.names.length} Kurse sind`} freigeschaltet:</b> ${loginNote.names.join(', ')}</span>
        <button class="btn small" onClick=${() => { setLoginNote(null); go('home'); }}>Zu meinen Kursen</button>`}
      ${loginNote.kind === 'none' &&
      html`<span><b>Für ${loginNote.email} ist noch kein Kurs freigeschaltet.</b> Hast du mit einer anderen E-Mail-Adresse gekauft? Dann melde dich mit dieser an.
          Direkt nach dem Kauf kann es ein paar Minuten dauern.${CONFIG.helpUrl ? html` <a href=${CONFIG.helpUrl} target="_blank" rel="noopener">Hilfe</a>` : ''}</span>
        <span class="row">
          <button class="btn small" onClick=${() => setShowAccount(true)}>Andere Adresse</button>
          <button class="btn ghost small" onClick=${() => setLoginNote(null)}>Schließen</button>
        </span>`}
      ${loginNote.kind === 'error' &&
      html`<span><b>Deine Kurse konnten gerade nicht geladen werden.</b> Prüfe deine Internetverbindung.</span>
        <button class="btn small" onClick=${() => { setLoginNote({ kind: 'loading' }); doSync(); }}>Erneut versuchen</button>`}
    </div>`;

  return html`
    <header class=${`top ${slim ? 'slim' : ''}`}>
      <div class="brand" onClick=${() => go('home')} title="Modern Chess Trainer"><img src="icons/logo-wordmark-trainer.png" alt="Modern Chess Trainer" /></div>
      <nav>
        <button class=${isHome ? 'on' : ''} onClick=${() => go('home')}>Start</button>
        <button class=${inTools ? 'on' : ''} onClick=${() => go('compare')} title="Partien von Lichess und Chess.com laden: Eröffnungsstatistik und Abgleich mit dem Repertoire">Meine Partien</button>
        <button class=${view.name === 'analyse' ? 'on' : ''} onClick=${() => go('analyse')} title="Freies Brett mit Stockfish, Cloud-Bewertung und Eröffnungsdatenbank">Analyse</button>
      </nav>
      <div class="top-right">
        <button class="acct gear" onClick=${() => setShowBoard(true)} title="Brett-Einstellungen: Farben, Größe, Zugeingabe" aria-label="Brett-Einstellungen">⚙ Brett</button>
        ${cloudEnabled() &&
        html`<button class=${`acct ${account ? 'in' : ''}`} onClick=${() => setShowAccount(true)} title=${account ? 'Dein Konto' : 'Anmelden, um auf allen Geräten zu lernen'}>
          ${account ? html`<span class=${`dot ${syncStatus}`}></span> Konto` : 'Anmelden'}
        </button>`}
      </div>
    </header>
    ${showBoard && html`<${BoardSettings} settings=${db.settings} setSettings=${setSettings} onClose=${() => setShowBoard(false)} />`}
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
    ${note}
    ${courseNote &&
    html`<div class="login-note found" role="status">
      <span><b>${courseNote.length === 1 ? `Der Kurs „${courseNote[0]}“ wurde` : `${courseNote.length} Kurse wurden`} aktualisiert.</b>${courseNote.length > 1 ? ' ' + courseNote.join(', ') + '.' : ''} Dein Lernfortschritt ist erhalten geblieben.</span>
      <button class="btn ghost small" onClick=${() => setCourseNote(null)}>Schließen</button>
    </div>`}
    ${['home', 'rep'].includes(view.name) &&
    db.repertoires
      .filter(r => r.updateAvailable && !r.locked)
      .map(
        r => html`<div class="login-note" role="status" key=${r.id}>
          <span><b>Für „${r.name}“ gibt es eine neue Fassung.</b> ${r.pristine === false ? 'Du hast diesen Kurs selbst bearbeitet. ' : ''}Falls du in diesem Kurs im Editor
            etwas geändert hast, geht das beim Aktualisieren verloren. Dein Lernfortschritt bleibt.</span>
          <span class="row">
            <button class="btn primary small" disabled=${courseBusy === r.id} onClick=${() => answerCourseUpdate(r.id, true)}>${courseBusy === r.id ? 'Lädt …' : 'Aktualisieren'}</button>
            <button class="btn ghost small" disabled=${courseBusy === r.id} onClick=${() => answerCourseUpdate(r.id, false)}>Meine Fassung behalten</button>
          </span>
        </div>`,
      )}
    <main class=${view.name === 'edit' || view.name === 'analyse' ? 'wide' : ''}>${body}</main>
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
