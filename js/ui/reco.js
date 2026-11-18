// Repertoire-Empfehlung in der Oberfläche: Karte in der Eröffnungsstatistik und kurzer Hinweis auf der Startseite.
import { html, useEffect, useMemo, useState } from 'preact';
import { loadCatalog, recommend, reasonText } from '../lib/recommend.js';

/** Empfehlungen für eine Farbe (oder beide), sobald die Kursliste geladen ist. */
function useReco(db, colors) {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    if (db.games.length) loadCatalog().then(setCatalog).catch(() => {});
  }, [db.games.length > 0]);
  const hidden = db.settings.recoHidden;
  return useMemo(() => {
    if (!catalog) return [];
    const owned = new Set(db.repertoires.filter(r => String(r.id).startsWith('course-') && !r.locked && !r.lock).map(r => r.id.slice('course-'.length)));
    return colors.flatMap(color => recommend(db.games, color, catalog, { owned, hidden: hidden || {} }));
  }, [catalog, db.games, db.repertoires, hidden, colors.join()]);
}

export function RecoCards({ color, db, setSettings, openRep }) {
  const list = useReco(db, [color]);
  if (!list.length) return null;
  const hide = id => setSettings({ recoHidden: { ...(db.settings.recoHidden || {}), [id]: true } });
  return html`<div class="stack">
    ${list.map(
      r => html`<div class="card reco" key=${r.id}>
        <img class="reco-cover" src=${r.cover} alt="" loading="lazy" />
        <div class="reco-body">
          <div class="eyebrow">${r.ownedCourseId ? 'Du hast diesen Kurs schon' : 'Passend zu deinen Partien'}</div>
          <h3 class="flat">${r.title}</h3>
          <p>${reasonText(r)}</p>
          <p class="muted small">${r.ownedCourseId ? 'Diese Varianten stehen in deinem Kurs. Wiederhole sie im Trainer.' : r.text}</p>
          <div class="row between">
            ${r.ownedCourseId
              ? html`<button class="btn primary" onClick=${() => openRep('course-' + r.ownedCourseId)}>Diese Varianten lernen</button>`
              : html`<a class="btn primary" href=${r.url} target="_blank" rel="noopener">Zum Kurs ↗</a>`}
            <button class="link muted small" onClick=${() => hide(r.id)}>Nicht mehr anzeigen</button>
          </div>
        </div>
      </div>`,
    )}
  </div>`;
}

/** Startseite: ein Satz, nur wenn Partien geladen sind und es eine Empfehlung für einen Kurs gibt, den der Nutzer nicht hat. */
export function HomeReco({ db, setSettings, go }) {
  const list = useReco(db, ['white', 'black']).filter(r => !r.ownedCourseId);
  if (!list.length || db.settings.recoHomeOff) return null;
  const r = list[0];
  return html`<div class="card reco-hint">
    <span><b>Tipp aus deinen Partien:</b> ${reasonText(r).split('. ')[0]}.</span>
    <span class="row">
      <button class="btn small" onClick=${() => go('compare')}>Auswertung ansehen</button>
      <button class="link muted small" onClick=${() => setSettings({ recoHomeOff: true })}>Ausblenden</button>
    </span>
  </div>`;
}
