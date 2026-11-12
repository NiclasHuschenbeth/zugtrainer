// Kleiner Key-Value-Speicher auf IndexedDB. Alle Daten bleiben im Browser des Nutzers.
let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('zugtrainer', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

export async function kvGet(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function kvSet(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAll() {
  const [repertoires, progress, games, accounts, activity, settings, sync] = await Promise.all(
    ['repertoires', 'progress', 'games', 'accounts', 'activity', 'settings', 'sync'].map(k => kvGet(k).catch(() => undefined)),
  );
  return {
    settings: { teach: true, sound: true, compare: {}, explorer: 'all', engine: false, cloud: true, coverMin: 0.02, lichessToken: null, ...(settings || {}) },
    activity: activity || { goal: 20, days: {} },
    repertoires: repertoires || [],
    progress: progress || {},
    games: games || [],
    accounts: accounts || { lichess: '', chesscom: '' },
    sync: { userId: null, last: 0, cardsPull: 0, cardsPushed: 0, tombstones: {}, ...(sync || {}) },
  };
}
