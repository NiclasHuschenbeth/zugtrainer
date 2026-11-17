// Auswahl der freigeschalteten Kurse: welche sollen im Trainer erscheinen?
// Kommt bei der ersten Anmeldung und jederzeit über „Kurse auswählen“. Nicht gewählte Kurse stehen unter
// „Weitere freigeschaltete Kurse“ und lassen sich dort mit einem Klick dazuholen; der Lernstand bleibt erhalten.
import { html, useState } from 'preact';

const LEVEL_RE = /\s*[-–:(]*\s*\b(Basis|Fortgeschritten)\b\)?\s*/i;

/** "Spiele 1.e4 wie The Big Greek – Basis" -> { base: "Spiele 1.e4 wie The Big Greek", level: "Basis" } */
export function splitLevel(name) {
  const m = LEVEL_RE.exec(name || '');
  if (!m) return { base: name || '', level: '' };
  const base = (name.slice(0, m.index) + ' ' + name.slice(m.index + m[0].length)).trim();
  return { base: base || name, level: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() };
}

/** Vorauswahl beim ersten Mal: alles außer „Fortgeschritten“. */
export const defaultPick = c => !/fortgeschritten/i.test(c.name || '');

/** Kurse nach Grundtitel gruppieren (Basis und Fortgeschritten zusammen), sortiert wie geliefert. */
function groupsOf(courses) {
  const map = new Map();
  for (const c of courses) {
    const { base, level } = splitLevel(c.name);
    if (!map.has(base)) map.set(base, []);
    map.get(base).push({ ...c, level });
  }
  return [...map.entries()].map(([base, items]) => ({ base, items: items.sort((a, b) => (a.level === 'Basis' ? -1 : b.level === 'Basis' ? 1 : 0)) }));
}

export function CourseChoice({ courses, chosen, first, onApply, onClose }) {
  const [sel, setSel] = useState(() => new Set(courses.filter(c => chosen(c)).map(c => String(c.id))));
  const flip = (id, on) => {
    const n = new Set(sel);
    on ? n.add(id) : n.delete(id);
    setSel(n);
  };
  const groups = groupsOf(courses);
  return html`<div class="modal" onClick=${e => !first && e.target === e.currentTarget && onClose()}>
    <div class="modal-box course-choice" role="dialog" aria-label="Kurse auswählen">
      <div class="row between">
        <h2 class="flat">${first ? 'Deine Kurse' : 'Kurse auswählen'}</h2>
        ${!first && html`<button class="btn ghost small" onClick=${onClose}>Abbrechen</button>`}
      </div>
      <p class="muted small">${first ? 'Diese Kurse sind für dich freigeschaltet. ' : ''}Welche möchtest du im Trainer haben? Die anderen findest du auf der Startseite unter „Weitere freigeschaltete Kurse“ und kannst sie jederzeit dazuholen. Dein Lernstand bleibt dabei erhalten.</p>
      <div class="row">
        <button class="btn small" onClick=${() => setSel(new Set(courses.map(c => String(c.id))))}>Alle</button>
        <button class="btn small" onClick=${() => setSel(new Set(courses.filter(defaultPick).map(c => String(c.id))))}>Ohne „Fortgeschritten“</button>
        <span class="muted small">${sel.size} von ${courses.length} gewählt</span>
      </div>
      <div class="cc-list">
        ${groups.map(g =>
          g.items.length === 1 && !g.items[0].level
            ? html`<label class="check cc-item"><input type="checkbox" checked=${sel.has(String(g.items[0].id))} onChange=${e => flip(String(g.items[0].id), e.target.checked)} /> ${g.base}</label>`
            : html`<div class="cc-group">
                <div class="cc-base">${g.base}</div>
                ${g.items.map(c => html`<label class="check cc-item sub"><input type="checkbox" checked=${sel.has(String(c.id))} onChange=${e => flip(String(c.id), e.target.checked)} /> ${c.level || c.name}</label>`)}
              </div>`,
        )}
      </div>
      <div class="row">
        <button class="btn primary" onClick=${() => onApply(sel)}>${sel.size ? `${sel.size} ${sel.size === 1 ? 'Kurs' : 'Kurse'} laden` : 'Keinen Kurs laden'}</button>
      </div>
    </div>
  </div>`;
}

/** Startseite: freigeschaltete Kurse, die gerade nicht im Trainer sind, plus „Kurse auswählen“. */
export function MoreCourses({ courses, busy, onAdd, onChoose }) {
  return html`<details class="card more-courses">
    <summary><b>Weitere freigeschaltete Kurse</b> <span class="muted small">(${courses.length})</span></summary>
    <div class="stack tight">
      ${courses.length
        ? courses.map(c => html`<div class="row between mc-row">
            <span>${c.name}</span>
            <button class="btn small" disabled=${busy === String(c.id)} onClick=${() => onAdd(String(c.id))}>${busy === String(c.id) ? 'lädt …' : 'Hinzufügen'}</button>
          </div>`)
        : html`<p class="muted small">Alle deine Kurse sind im Trainer.</p>`}
      <button class="link small" onClick=${onChoose}>Kurse auswählen …</button>
    </div>
  </details>`;
}
