// Anbindung an Supabase: Anmeldung per E-Mail-Link und die Server-Seite des Abgleichs (siehe sync.js).
import { CONFIG } from '../config.js';

export const cloudEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseKey);

/** Gibt es auf diesem Gerät schon eine Sitzung (oder kommt gerade ein Anmelde-Link an)? Nur dann laden wir die Bibliothek sofort. */
export function maySignedIn() {
  if (!cloudEnabled()) return false;
  try {
    const key = 'sb-' + new URL(CONFIG.supabaseUrl).hostname.split('.')[0] + '-auth-token';
    return !!localStorage.getItem(key) || /access_token=|error_description=/.test(location.hash);
  } catch {
    return false;
  }
}

let clientPromise = null;

/** Lädt die Supabase-Bibliothek erst bei Bedarf; ohne Internet bleibt die App trotzdem voll nutzbar. */
export function getClient() {
  if (!cloudEnabled()) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = new Promise((resolve, reject) => {
      const make = () => {
        try {
          resolve(
            window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
              auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
            }),
          );
        } catch (err) {
          reject(err);
        }
      };
      if (window.supabase) return make();
      const s = document.createElement('script');
      s.src = new URL('../../vendor/supabase/supabase.js', import.meta.url).href;
      s.onload = make;
      s.onerror = () => {
        clientPromise = null;
        reject(new Error('Die Konto-Funktion konnte nicht geladen werden (offline?).'));
      };
      document.head.appendChild(s);
    });
  }
  return clientPromise;
}

/** Aktuelle Sitzung aus dem Gerät (funktioniert auch offline). -> { userId, email } | null */
export async function currentSession() {
  const c = await getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  const u = data && data.session && data.session.user;
  return u ? { userId: u.id, email: u.email } : null;
}

export async function onAuthChange(cb) {
  const c = await getClient();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_event, session) => {
    const u = session && session.user;
    cb(u ? { userId: u.id, email: u.email } : null);
  });
  return () => data.subscription.unsubscribe();
}

/** Schickt den Anmelde-Link. Legt bei der ersten Anmeldung automatisch ein Konto an. */
export async function sendLoginLink(email) {
  const c = await getClient();
  const { error } = await c.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
  });
  if (error) throw error;
}

/** Falls die Mail einen Code enthält (eigener Mailversand mit angepasster Vorlage). */
export async function verifyCode(email, token) {
  const c = await getClient();
  const { error } = await c.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
  if (error) throw error;
}

/** Löscht das Konto samt aller Daten auf dem Server (die Daten auf diesem Gerät bleiben). */
export async function deleteAccount() {
  const c = await getClient();
  const { error } = await c.rpc('delete_my_account');
  if (error) throw error;
  await c.auth.signOut({ scope: 'local' }).catch(() => {});
}

export async function signOut() {
  const c = await getClient();
  await c.auth.signOut();
}

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Server-Seite des Abgleichs auf Basis von Supabase. */
export async function supabaseRemote(userId) {
  const c = await getClient();
  return {
    async getProfile() {
      const d = must(await c.from('profiles').select('activity,settings').eq('user_id', userId).maybeSingle());
      return d || null;
    },
    async putProfile(p) {
      must(await c.from('profiles').upsert({ user_id: userId, activity: p.activity, settings: p.settings, updated_at: Date.now() }));
    },
    async listReps() {
      return must(await c.from('repertoires').select('id,updated_at,deleted'));
    },
    async getReps(ids) {
      const out = {};
      for (let i = 0; i < ids.length; i += 5) {
        const rows = must(await c.from('repertoires').select('id,data').in('id', ids.slice(i, i + 5)));
        for (const r of rows) if (r.data) out[r.id] = r.data;
      }
      return out;
    },
    async putReps(rows) {
      for (const r of rows) {
        must(await c.from('repertoires').upsert({ user_id: userId, id: r.id, data: r.data, updated_at: r.updated_at, deleted: r.deleted }));
      }
    },
    async pullCards(since) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = must(await c.from('cards').select('rep_id,key,level,due,lapses,at').gt('at', since).order('at').range(from, from + 999));
        out.push(...rows);
        if (rows.length < 1000) break;
      }
      return out;
    },
    async pushCards(rows) {
      must(await c.from('cards').upsert(rows.map(r => ({ ...r, user_id: userId }))));
    },
    async deleteCards(repId) {
      must(await c.from('cards').delete().eq('rep_id', repId));
    },
  };
}
