import { html, useEffect, useRef, useState } from 'preact';

/** Aufklappmenü (Werkzeuge). Schließt bei Klick daneben, Escape oder Auswahl. */
export function Menu({ label, className = '', align = 'left', children }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = e => box.current && !box.current.contains(e.target) && setOpen(false);
    const esc = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return html`<div class="menu" ref=${box}>
    <button class=${`menu-btn ${className} ${open ? 'on' : ''}`} aria-haspopup="true" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      ${label} <span class="caret" aria-hidden="true">▾</span>
    </button>
    ${open && html`<div class=${`menu-list ${align}`} role="menu" onClick=${() => setOpen(false)}>${children}</div>`}
  </div>`;
}

/** Eintrag im Menü, mit kurzer Erklärung in einem Halbsatz. */
export function MenuItem({ title, hint, onClick, danger }) {
  return html`<button class=${`menu-item ${danger ? 'danger' : ''}`} role="menuitem" onClick=${onClick}>
    <b>${title}</b>${hint && html`<span>${hint}</span>`}
  </button>`;
}

export const MenuDivider = () => html`<div class="menu-sep"></div>`;
