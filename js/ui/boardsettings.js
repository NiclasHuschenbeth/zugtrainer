import { html } from 'preact';

export const THEMES = [
  { id: 'modern', name: 'Modern Chess', light: '#EFEFEF', dark: '#7796AA' },
  { id: 'blue', name: 'Blau', light: '#E8EFF6', dark: '#7F9BBE' },
  { id: 'brown', name: 'Klassisch braun', light: '#F0D9B5', dark: '#B58863' },
];
export const SIZES = ['Klein', 'Mittel', 'Normal', 'Groß', 'Maximal'];

/** Einstellungen rund ums Brett. Gelten überall im Trainer und werden mit dem Konto synchronisiert. */
export function BoardSettings({ settings, setSettings, onClose }) {
  const theme = settings.boardTheme || 'modern';
  const size = settings.boardSize || 3;
  return html`<div class="modal" onClick=${ev => ev.target === ev.currentTarget && onClose()}>
    <div class="modal-box account" role="dialog" aria-label="Brett-Einstellungen">
      <div class="row between top-align">
        <h2 class="flat">Brett</h2>
        <button class="btn ghost small" onClick=${onClose}>Schließen</button>
      </div>

      <div class="stack tight">
        <b>Brettfarben</b>
        <div class="theme-options">
          ${THEMES.map(t => html`<button class=${`theme-opt ${theme === t.id ? 'on' : ''}`} onClick=${() => setSettings({ boardTheme: t.id })}>
            <span class="swatch" style=${{ background: `linear-gradient(90deg, ${t.light} 50%, ${t.dark} 50%)` }}></span>
            <span>${t.name}</span>
          </button>`)}
        </div>
      </div>

      <div class="stack tight size-setting">
        <label for="board-size"><b>Brettgröße</b> <span class="muted small">(am Computer, beim Lernen)</span></label>
        <input id="board-size" type="range" min="1" max="5" step="1" value=${size} onInput=${ev => setSettings({ boardSize: +ev.target.value })} />
        <div class="depth-scale">${SIZES.map(s => html`<span class=${s === SIZES[size - 1] ? 'on' : ''}>${s}</span>`)}</div>
      </div>

      <div class="stack tight">
        <b>Beim Ziehen</b>
        <label class="check"><input type="checkbox" checked=${settings.showDests !== false} onChange=${ev => setSettings({ showDests: ev.target.checked })} /> Mögliche Zielfelder zeigen</label>
        <div class="muted small hint">Aus: Du siehst keine Punkte und musst den Zug wirklich wissen.</div>
        <label class="check"><input type="checkbox" checked=${settings.anim !== false} onChange=${ev => setSettings({ anim: ev.target.checked })} /> Züge animieren</label>
        <label class="field">Tempo der vorgespielten Züge
          <select value=${settings.tempo || 'normal'} onChange=${ev => setSettings({ tempo: ev.target.value })}>
            <option value="slow">Langsam</option>
            <option value="normal">Normal</option>
            <option value="fast">Schnell</option>
          </select>
        </label>
        <label class="field">Zugeingabe
          <select value=${settings.moveInput || 'both'} onChange=${ev => setSettings({ moveInput: ev.target.value })}>
            <option value="both">Ziehen oder anklicken</option>
            <option value="drag">Nur ziehen</option>
            <option value="click">Nur anklicken (zwei Klicks)</option>
          </select>
        </label>
      </div>
    </div>
  </div>`;
}
