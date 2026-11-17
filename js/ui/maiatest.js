// Versteckte Messseite (#/maia-test): Wie schnell lädt und zieht Maia auf diesem Gerät?
// Nur zum Ausprobieren auf dem Handy gedacht, nicht im Menü verlinkt.
import { html, useState } from 'preact';
import { loadMaia, maiaMoves } from '../lib/maia.js';

const MODEL = new URL('../../vendor/maia/maia3-5m.fp16.onnx', import.meta.url).href;
const FENS = [
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/8/PPP2PPP/RNBQKB1R w KQkq - 1 5',
  'r1bq1rk1/pp2bppp/2nppn2/8/2BNP3/2N1B3/PPP2PPP/R2QK2R w KQ - 4 9',
];
const sec = ms => (ms / 1000).toFixed(2).replace('.', ',') + ' s';

export function MaiaTest({ onExit }) {
  const [state, setState] = useState({ phase: 'idle' }); // idle | load | moves | done | error
  const [copied, setCopied] = useState(false);

  const run = async fresh => {
    setCopied(false);
    try {
      let cached = false;
      try {
        cached = !!(await caches.match(MODEL, { ignoreSearch: true }));
      } catch {
        // ohne Zwischenspeicher
      }
      // "Ab Null": gespeichertes Modell löschen und die Seite neu laden (sonst bleibt es im Arbeitsspeicher)
      if (fresh && cached) {
        for (const k of await caches.keys()) if (k.includes('gross')) await caches.delete(k);
        sessionStorage.setItem('zt-maia-fresh', '1');
        return location.reload();
      }
      const wasFresh = sessionStorage.getItem('zt-maia-fresh') === '1' || !cached;
      sessionStorage.removeItem('zt-maia-fresh');
      setState({ phase: 'load' });
      const t0 = performance.now();
      await loadMaia();
      const load = performance.now() - t0;
      setState({ phase: 'moves', load });
      const times = [];
      for (let i = 0; i < 20; i++) {
        const s = performance.now();
        await maiaMoves(FENS[i % FENS.length], 1600);
        times.push(performance.now() - s);
      }
      times.sort((a, b) => a - b);
      setState({ phase: 'done', load, fresh: wasFresh, median: times[10], max: times[19], min: times[0] });
    } catch (err) {
      setState({ phase: 'error', error: String((err && err.message) || err) });
    }
  };

  const s = state;
  const conn = navigator.connection && navigator.connection.effectiveType;
  const text =
    s.phase === 'done'
      ? [
          `Maia-Messung ${new Date().toLocaleString('de-DE')}`,
          `Laden: ${sec(s.load)} (${s.fresh ? 'erstes Mal, aus dem Internet' : 'aus dem Gerätespeicher'})`,
          `Ein Zug: im Mittel ${sec(s.median)}, schnellster ${sec(s.min)}, langsamster ${sec(s.max)}`,
          `Gerät: ${navigator.userAgent}`,
          `Prozessorkerne: ${navigator.hardwareConcurrency || '?'}${conn ? ` · Verbindung: ${conn}` : ''}`,
        ].join('\n')
      : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return html`<div class="card stack tight maia-test">
    <div class="row between">
      <h2 class="flat">Maia-Messung</h2>
      <button class="btn ghost small" onClick=${onExit}>Schließen</button>
    </div>
    <p class="muted">Misst, wie lange Maia auf diesem Gerät zum Laden braucht und wie schnell ein Zug berechnet wird. Es werden keine Daten verschickt.</p>
    <div class="row">
      <button class="btn primary" disabled=${s.phase === 'load' || s.phase === 'moves'} onClick=${() => run(false)}>Messen</button>
      <button class="btn" disabled=${s.phase === 'load' || s.phase === 'moves'} onClick=${() => run(true)} title="Löscht das gespeicherte Modell und lädt es neu aus dem Internet">Messen ab Null (lädt 22 MB neu)</button>
    </div>
    ${s.phase === 'load' && html`<div class="msg idle">Maia wird geladen …</div>`}
    ${s.phase === 'moves' && html`<div class="msg idle">Geladen in ${sec(s.load)}. Berechne 20 Züge …</div>`}
    ${s.phase === 'error' && html`<div class="msg bad">Fehler: ${s.error}</div>`}
    ${s.phase === 'done' && html`<div class="msg ok">
      <div><b>Laden:</b> ${sec(s.load)} ${s.fresh ? '(erstes Mal, aus dem Internet)' : '(aus dem Gerätespeicher)'}</div>
      <div><b>Ein Zug:</b> im Mittel ${sec(s.median)}, langsamster ${sec(s.max)}</div>
    </div>
    <div class="row">
      <button class="btn" onClick=${copy}>${copied ? 'Kopiert ✓' : 'Ergebnis kopieren'}</button>
    </div>
    <pre class="small muted maia-raw">${text}</pre>`}
  </div>`;
}
