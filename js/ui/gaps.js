// „Lücken finden“: Wo fehlt meinem Repertoire etwas?
// Reiter 1 – aus den eigenen Partien (Abweichungen, fehlende Gegnerzüge, Eröffnungsstatistik).
// Reiter 2 – aus der Datenbank (häufige Gegnerzüge, die im Repertoire fehlen).
import { html, useState } from 'preact';
import { CompareView } from './compare.js';
import { CoveragePanel } from './editor.js';

export function GapsView({ db, defaultRepId, go, train, setSettings, update, openRep, editAt }) {
  const reps = db.repertoires.filter(r => !r.lock && !r.locked && r.chapters && r.chapters.length);
  const [repId, setRepId] = useState(() => (reps.some(r => r.id === defaultRepId) ? defaultRepId : reps[0] ? reps[0].id : null));
  const [tab, setTab] = useState('games');
  const rep = reps.find(r => r.id === repId) || reps[0] || null;
  const pick = id => {
    setRepId(id);
    const r = reps.find(x => x.id === id);
    // Auswertung der Partien merkt sich das Repertoire je Farbe
    if (r) setSettings({ compare: { ...(db.settings.compare || {}), [r.color]: r.id } });
  };
  const group = color => reps.filter(r => r.color === color);

  return html`<div class="stack gaps">
    <div>
      <h1>Lücken finden</h1>
      <p class="muted">Wo fehlt deinem Repertoire etwas? Einmal aus deinen eigenen Partien, einmal aus den Zügen, die in der Datenbank häufig gespielt werden.</p>
    </div>
    ${rep && html`<label class="gaps-rep">Repertoire
      <select value=${rep.id} onChange=${e => pick(e.target.value)}>
        ${['white', 'black'].map(c => group(c).length > 0 && html`<optgroup label=${c === 'white' ? 'Mit Weiß' : 'Mit Schwarz'}>
          ${group(c).map(r => html`<option value=${r.id}>${r.name}</option>`)}
        </optgroup>`)}
      </select>
    </label>`}
    <div class="tabs">
      <button class=${tab === 'games' ? 'on' : ''} onClick=${() => setTab('games')}>Aus meinen Partien</button>
      <button class=${tab === 'db' ? 'on' : ''} disabled=${!rep} onClick=${() => setTab('db')}>Aus der Datenbank</button>
    </div>
    ${tab === 'games'
      ? html`<${CompareView} db=${db} go=${go} train=${train} setSettings=${setSettings} update=${update} openRep=${openRep} fixedRep=${rep} />`
      : rep && html`<${CoveragePanel} key=${rep.id} rep=${rep} settings=${db.settings} setSettings=${setSettings} onJump=${(ci, path) => editAt(rep.id, { ci, path })} />`}
  </div>`;
}
