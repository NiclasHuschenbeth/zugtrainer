// Testseite für F20: Gehen mehrere Kerne für Stockfish, ohne dass Bot-Schutz, Anmeldung oder fremde Dienste kaputtgehen?
// Nicht verlinkt. Zwei Varianten mit unterschiedlichen Kopfzeilen (siehe _headers): locker/ und streng/.
import { CONFIG } from '../js/config.js';
import { engineThreads } from '../js/lib/engine.js';

const $ = id => document.getElementById(id);
const FEN = 'r1bq1rk1/pp2bppp/2nppn2/8/2BNP3/2N1B3/PPP2PPP/R2QK2R w KQ - 4 9';
const SECONDS = 6;
const rows = [];

function put(name, ok, text) {
  rows.push(`${ok === null ? '…' : ok ? 'OK' : 'FEHLER'}  ${name}: ${text}`);
  const li = document.createElement('li');
  li.className = ok === null ? '' : ok ? 'ok' : 'bad';
  li.textContent = `${name}: ${text}`;
  $('list').append(li);
}

function bench(url, threads) {
  return new Promise(resolve => {
    const w = new Worker(url);
    let last = null;
    const done = r => {
      clearTimeout(t);
      w.terminate();
      resolve(r);
    };
    const t = setTimeout(() => done({ error: 'keine Antwort' }), (SECONDS + 15) * 1000);
    w.onerror = e => done({ error: e.message || 'konnte nicht starten' });
    w.onmessage = e => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line === 'uciok') {
        if (threads > 1) w.postMessage(`setoption name Threads value ${threads}`);
        w.postMessage('setoption name Hash value 64');
        w.postMessage('isready');
      } else if (line === 'readyok') {
        w.postMessage(`position fen ${FEN}`);
        w.postMessage(`go movetime ${SECONDS * 1000}`);
      } else if (line.startsWith('info') && / nps /.test(line)) {
        last = line;
      } else if (line.startsWith('bestmove')) {
        const num = k => +((last || '').match(new RegExp(` ${k} (\\d+)`)) || [0, 0])[1];
        done({ depth: num('depth'), nps: num('nps') });
      }
    };
    w.postMessage('uci');
  });
}

const fmt = n => n.toLocaleString('de-DE');

async function checkFetch(name, url, opts) {
  try {
    const r = await fetch(url, opts);
    put(name, r.ok, r.ok ? 'erreichbar' : `Antwort ${r.status}`);
  } catch (err) {
    put(name, false, String(err.message || err));
  }
}

function turnstile() {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ ok: false, text: 'nach 20 s keine Rückmeldung' }), 20000);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onerror = () => {
      clearTimeout(t);
      resolve({ ok: false, text: 'Skript wurde blockiert' });
    };
    s.onload = () => {
      try {
        window.turnstile.render($('captcha'), {
          sitekey: CONFIG.turnstileSiteKey,
          callback: () => {
            clearTimeout(t);
            resolve({ ok: true, text: 'Prüfung bestanden' });
          },
          'error-callback': code => {
            clearTimeout(t);
            resolve({ ok: false, text: `Fehler ${code}` });
          },
        });
      } catch (err) {
        clearTimeout(t);
        resolve({ ok: false, text: String(err.message || err) });
      }
    };
    document.head.append(s);
  });
}

async function run() {
  $('go').disabled = true;
  $('list').textContent = '';
  rows.length = 0;
  const variant = location.pathname.includes('streng') ? 'streng' : 'locker';
  rows.push(`Kerntest (${variant}) ${new Date().toLocaleString('de-DE')}`);
  rows.push(`Gerät: ${navigator.userAgent}`);
  const iso = !!globalThis.crossOriginIsolated;
  put('Mehrere Kerne erlaubt', iso, iso ? 'ja' : 'nein, Browser verweigert es');
  put('Prozessorkerne', true, String(navigator.hardwareConcurrency || '?'));

  const ts = await turnstile();
  put('Bot-Schutz (Turnstile)', ts.ok, ts.text);
  await checkFetch('Anmeldedienst (Supabase)', `${CONFIG.supabaseUrl}/auth/v1/health`, { headers: { apikey: CONFIG.supabaseKey } });
  await checkFetch('Lichess', 'https://lichess.org/api/user/lichess');
  await checkFetch('Lichess-Datenbank', 'https://explorer.lichess.ovh/masters?fen=' + encodeURIComponent('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'));
  await checkFetch('ChessDB', 'https://www.chessdb.cn/cdb.php?action=queryall&json=1&board=' + encodeURIComponent('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'));

  put('Stockfish 1 Kern', null, `rechnet ${SECONDS} s …`);
  const one = await bench(new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url), 1);
  $('list').lastChild.remove();
  rows.pop();
  put('Stockfish 1 Kern', !one.error, one.error || `Tiefe ${one.depth}, ${fmt(one.nps)} Stellungen pro Sekunde`);

  const n = engineThreads();
  if (n > 1) {
    put(`Stockfish ${n} Kerne`, null, `rechnet ${SECONDS} s …`);
    const many = await bench(new URL('../vendor/stockfish/stockfish-19-lite.js', import.meta.url), n);
    $('list').lastChild.remove();
    rows.pop();
    put(
      `Stockfish ${n} Kerne`,
      !many.error,
      many.error ||
        `Tiefe ${many.depth}, ${fmt(many.nps)} Stellungen pro Sekunde` +
          (one.nps ? ` (${(many.nps / one.nps).toFixed(1).replace('.', ',')}-mal so schnell)` : ''),
    );
  }
  $('raw').textContent = rows.join('\n');
  $('copy').hidden = false;
  $('go').disabled = false;
}

$('go').onclick = run;
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(rows.join('\n'));
    $('copy').textContent = 'Kopiert ✓';
  } catch {
    // Kopieren nicht erlaubt: Text steht darunter
  }
};
