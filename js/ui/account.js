import { html, useEffect, useRef, useState } from 'preact';
import { CONFIG } from '../config.js';

/** Lädt Cloudflare Turnstile erst, wenn jemand die Anmeldung öffnet. */
let turnstileScript = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScript) {
    turnstileScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => {
        turnstileScript = null;
        reject(new Error('Der Bot-Schutz konnte nicht geladen werden. Bist du online?'));
      };
      document.head.appendChild(s);
    });
  }
  return turnstileScript;
}

const fmt = ts => (ts ? new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie');

/** Anmelde-Fenster (E-Mail-Link) bzw. Kontoübersicht mit Abgleich-Status. */
export function AccountDialog({ account, status, lastSync, onClose, onSend, onVerify, onSyncNow, onSignOut, onDelete }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email'); // email | sent
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const box = useRef(null);
  const widget = useRef(null);
  const needCaptcha = !!CONFIG.turnstileSiteKey;

  // Bot-Schutz: das Feld erscheint nur im Anmeldeformular
  useEffect(() => {
    if (!needCaptcha || account || step !== 'email' || !box.current) return;
    let gone = false;
    loadTurnstile()
      .then(ts => {
        if (gone || !box.current) return;
        widget.current = ts.render(box.current, {
          sitekey: CONFIG.turnstileSiteKey,
          theme: 'dark',
          language: 'de',
          callback: t => setToken(t),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        });
      })
      .catch(err => setError(err.message));
    return () => {
      gone = true;
      if (widget.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widget.current);
        } catch {
          // egal
        }
      }
      widget.current = null;
    };
  }, [account, step]);

  const run = async fn => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err && err.message ? err.message : 'Das hat leider nicht geklappt.');
    }
    setBusy(false);
  };

  const send = ev => {
    ev.preventDefault();
    run(async () => {
      try {
        await onSend(email.trim(), token);
      } catch (err) {
        // Ein Token gilt nur einmal: neues anfordern
        setToken('');
        if (widget.current != null && window.turnstile) window.turnstile.reset(widget.current);
        throw err;
      }
      setStep('sent');
    });
  };
  const verify = ev => {
    ev.preventDefault();
    run(async () => {
      await onVerify(email.trim(), code);
      onClose();
    });
  };

  return html`<div class="modal" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="modal-box account">
      <div class="row between">
        <h2 class="flat">${account ? 'Dein Konto' : 'Anmelden'}</h2>
        <button class="btn ghost small" onClick=${onClose}>Schließen</button>
      </div>

      ${account
        ? html`
            <p>Angemeldet als <b>${account.email}</b>.</p>
            <p class="muted small">
              Deine Repertoires und dein Lernfortschritt werden automatisch mit deinem Konto abgeglichen und stehen auf allen Geräten bereit.
              Ohne Internet arbeitest du weiter, der Abgleich holt sich danach alles nach.
            </p>
            <div class=${`msg ${status === 'error' ? 'bad' : status === 'syncing' ? 'info' : 'ok'}`}>
              ${status === 'syncing'
                ? 'Abgleich läuft …'
                : status === 'error'
                  ? 'Der letzte Abgleich ist fehlgeschlagen. Er wird automatisch erneut versucht.'
                  : status === 'offline'
                    ? 'Du bist offline. Der Abgleich läuft, sobald du wieder verbunden bist.'
                    : 'Alles abgeglichen.'}
              <div class="muted small">Zuletzt: ${fmt(lastSync)}</div>
            </div>
            <div class="row">
              <button class="btn primary" disabled=${status === 'syncing'} onClick=${onSyncNow}>Jetzt abgleichen</button>
              <button class="btn" onClick=${() => run(onSignOut)}>Abmelden</button>
            </div>
            <p class="muted small">Beim Abmelden werden die Daten von diesem Gerät entfernt. Sie bleiben in deinem Konto und kommen bei der nächsten Anmeldung zurück.</p>
            <p class="small"><button class="link danger" onClick=${() => run(onDelete)}>Konto und alle Daten im Konto löschen</button></p>
          `
        : step === 'email'
          ? html`<form class="stack" onSubmit=${send}>
              <p class="muted">
                Mit einem kostenlosen Konto sind deine Repertoires und dein Lernfortschritt auf allen deinen Geräten verfügbar.
                Du bekommst einen Anmelde-Link per E-Mail, ein Passwort brauchst du nicht.
              </p>
              <label>E-Mail-Adresse
                <input type="email" required autocomplete="email" value=${email} onInput=${e => setEmail(e.target.value)} placeholder="du@beispiel.de" />
              </label>
              ${needCaptcha && html`<div ref=${box} class="captcha"></div>`}
              ${error && html`<div class="msg bad">${error}</div>`}
              <div class="row">
                <button class="btn primary" type="submit" disabled=${busy || !email || (needCaptcha && !token)}>${busy ? 'Sende …' : 'Anmelde-Link senden'}</button>
              </div>
              <p class="muted small">
                Mit der Anmeldung stimmst du der Verarbeitung deiner E-Mail-Adresse zur Kontoverwaltung zu, siehe${' '}
                ${CONFIG.datenschutzUrl ? html`<a href=${CONFIG.datenschutzUrl} target="_blank" rel="noopener">Datenschutzerklärung</a>` : 'Datenschutzerklärung'}.
              </p>
            </form>`
          : html`<div class="stack">
              <div class="msg ok">Wir haben dir eine E-Mail an <b>${email}</b> geschickt. Klicke auf den Link darin – dann bist du angemeldet. Schau auch im Spam-Ordner nach.</div>
              ${CONFIG.emailCode &&
              html`<form class="stack" onSubmit=${verify}>
                <label>… oder gib den Code aus der E-Mail ein
                  <input type="text" inputmode="numeric" autocomplete="one-time-code" value=${code} onInput=${e => setCode(e.target.value)} placeholder="123456" />
                </label>
                <button class="btn primary" type="submit" disabled=${busy || !code}>Code bestätigen</button>
              </form>`}
              ${error && html`<div class="msg bad">${error}</div>`}
              <div class="row"><button class="btn ghost" onClick=${() => { setStep('email'); setError(''); }}>Andere Adresse verwenden</button></div>
            </div>`}
      ${account && error && html`<div class="msg bad">${error}</div>`}
    </div>
  </div>`;
}
