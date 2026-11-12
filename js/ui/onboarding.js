import { html, useEffect, useState } from 'preact';

const STEPS = ['Repertoire', 'Erste Linie', 'Tagesziel'];

const GOALS = [
  { n: 10, label: 'Entspannt' },
  { n: 20, label: 'Regelmäßig', rec: true },
  { n: 30, label: 'Ambitioniert' },
  { n: 50, label: 'Intensiv' },
];

/** Erststart in drei Schritten: Repertoire laden, erste Linie lernen, Tagesziel wählen. */
export function Onboarding({ step, rep, train, goal, setGoal, finish }) {
  return html`<div class="card onboarding">
    <div class="steps" aria-label=${`Schritt ${step} von 3`}>
      ${STEPS.map((t, i) => html`<div class=${`step ${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}`}>
        <b>${i + 1 < step ? '✓' : i + 1}</b><span>${t}</span>
      </div>`)}
    </div>

    ${step === 1 &&
    html`<div class="stack tight">
      <h1>Willkommen beim Modern Chess Trainer</h1>
      <p>In drei kurzen Schritten bist du startklar. Zuerst brauchst du ein Repertoire: die PGN-Datei zu deinem Kurs. Eine PGN-Datei ist die Datei, in der alle Varianten gespeichert sind.</p>
      <details class="howto">
        <summary>Wo bekomme ich die PGN-Datei?</summary>
        <ul>
          <li><b>Aus deinem Modern-Chess-Kurs:</b> Lade die PGN-Datei aus den Kursmaterialien (Downloads) auf dein Gerät.</li>
          <li><b>Aus einer Lichess-Studie:</b> Öffne die Studie, wähle im Menü „Als PGN herunterladen“ (bzw. „Study PGN“).</li>
          <li><b>Aus ChessBase:</b> Datenbank markieren, „Speichern unter“ und als PGN exportieren.</li>
        </ul>
      </details>
    </div>`}

    ${step === 2 &&
    html`<div class="stack tight">
      <h1>Lerne deine erste Linie</h1>
      <p>Dein Repertoire „${rep.name}“ ist geladen. Jetzt lernst du die erste Linie: Du siehst jeden Zug zuerst vorgespielt und spielst ihn danach selbst nach. Das dauert nur ein paar Minuten.</p>
      <div class="row"><button class="btn primary big" onClick=${() => train(rep.id, 'learn')}>Erste Linie lernen</button></div>
    </div>`}

    ${step === 3 &&
    html`<div class="stack tight">
      <h1>Wie viele Züge möchtest du pro Tag üben?</h1>
      <p>Regelmäßig üben schlägt langes Üben. Dein Tagesziel kannst du später jederzeit ändern.</p>
      <div class="goal-options">
        ${GOALS.map(g => html`<button class=${`goal-opt ${g.rec ? 'rec' : ''} ${goal === g.n ? 'on' : ''}`} onClick=${() => { setGoal(g.n); finish(); }}>
          <b>${g.n} Züge</b><span>${g.label}</span>${g.rec && html`<small>empfohlen</small>`}
        </button>`)}
      </div>
    </div>`}

    <div class="row between">
      <span class="muted small">Schritt ${step} von 3</span>
      <button class="link small" onClick=${finish}>Einführung überspringen</button>
    </div>
  </div>`;
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const ShareIcon = () => html`<svg class="share-icon" viewBox="0 0 24 24" width="18" height="18" aria-label="Teilen-Symbol" role="img">
  <path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

/** Einmaliger Hinweis nach der ersten Lerneinheit: Trainer auf den Startbildschirm legen. */
export function InstallHint({ dismiss }) {
  const [evt, setEvt] = useState(window.__installPrompt || null);
  useEffect(() => {
    const got = () => setEvt(window.__installPrompt || null);
    const installed = () => dismiss();
    window.addEventListener('zt-install', got);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('zt-install', got);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (isStandalone()) return null;
  const ios = isIos();
  if (!ios && !evt) return null;

  const install = async () => {
    try {
      evt.prompt();
      await evt.userChoice;
    } catch {
      // egal
    }
    dismiss();
  };

  return html`<div class="card install">
    <div class="row between top-align">
      <div>
        <h3 class="flat">Als App auf deinem Startbildschirm</h3>
        <p class="muted">So startet der Trainer wie eine App und funktioniert auch ohne Internet.</p>
        ${ios && html`<p>Tippe unten in Safari auf das Teilen-Symbol <${ShareIcon} /> und wähle „Zum Home-Bildschirm“.</p>`}
      </div>
      <button class="link small" onClick=${dismiss} aria-label="Hinweis schließen">Schließen</button>
    </div>
    <div class="row">
      ${!ios && evt && html`<button class="btn primary" onClick=${install}>Installieren</button>`}
      <button class=${`btn ${ios ? 'primary' : ''}`} onClick=${dismiss}>${ios ? 'Verstanden' : 'Nein danke'}</button>
    </div>
  </div>`;
}
