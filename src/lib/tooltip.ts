// Infobulle légère (attachement Svelte) : `<button {@attach tooltip('Retour')}>`.
// - Premier affichage après 400 ms (évite les apparitions accidentelles au survol).
// - Tant qu'une infobulle vient d'être visible, les suivantes apparaissent tout de suite, sans animation.
// - Affichée dans la top layer (popover manuel) pour passer au-dessus des modales.
// - Purement visuelle : le nom accessible doit déjà être porté par l'élément (aria-label, texte).

import type { Attachment } from 'svelte/attachments';

const DELAY = 400;
const GRACE = 300;

let tip: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastHidden = 0;

const CSS = `
.pm-tooltip {
  position: fixed; inset: auto; margin: 0; padding: 4px 8px; border: 0;
  max-width: 280px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  border-radius: 6px; background: var(--text); color: var(--bg);
  font: 500 12px/1.35 var(--font); box-shadow: var(--shadow-md);
  pointer-events: none; opacity: 1; transform: none;
  transition: opacity 125ms var(--ease-out), transform 125ms var(--ease-out);
}
@starting-style { .pm-tooltip:popover-open { opacity: 0; transform: scale(0.97); } }
.pm-tooltip[data-instant] { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .pm-tooltip { transition: opacity 125ms ease; }
  @starting-style { .pm-tooltip:popover-open { transform: none; } }
}`;

function ensure(): HTMLDivElement {
  if (tip?.isConnected) return tip;
  if (!document.getElementById('pm-tooltip-style')) {
    const style = document.createElement('style');
    style.id = 'pm-tooltip-style';
    style.textContent = CSS;
    document.head.append(style);
  }
  tip = document.createElement('div');
  tip.className = 'pm-tooltip';
  tip.setAttribute('popover', 'manual');
  tip.setAttribute('aria-hidden', 'true');
  document.body.append(tip);
  return tip;
}

function isOpen(el: HTMLElement) {
  return el.matches(':popover-open');
}

function show(node: HTMLElement, text: string, instant: boolean) {
  const el = ensure();
  owner = node;
  el.textContent = text;
  el.toggleAttribute('data-instant', instant);
  // Ré-ouvrir pour repasser au sommet de la top layer (ex. au-dessus d'une modale ouverte entre-temps).
  if (isOpen(el)) el.hidePopover();
  el.showPopover();
  const r = node.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const above = r.top - h - 6 >= 4;
  const top = above ? r.top - h - 6 : r.bottom + 6;
  const left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 4));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.transformOrigin = above ? 'bottom center' : 'top center';
}

function hide(node: HTMLElement) {
  clearTimeout(timer);
  if (owner !== node) return;
  owner = null;
  if (tip && isOpen(tip)) {
    tip.hidePopover();
    lastHidden = performance.now();
  }
}

export function tooltip(text: string | null | undefined): Attachment<HTMLElement> {
  return (node) => {
    if (!text) return;
    const label = text;

    function warm() {
      return (tip !== null && isOpen(tip)) || performance.now() - lastHidden < GRACE;
    }

    function onenter(e: PointerEvent) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer);
      if (warm()) show(node, label, true);
      else timer = setTimeout(() => show(node, label, false), DELAY);
    }

    function onfocus() {
      // Focus clavier : on affiche tout de suite et sans animation.
      if (node.matches(':focus-visible')) show(node, label, true);
    }

    const off = () => hide(node);

    node.addEventListener('pointerenter', onenter);
    node.addEventListener('pointerleave', off);
    node.addEventListener('pointerdown', off);
    node.addEventListener('focus', onfocus);
    node.addEventListener('blur', off);
    node.addEventListener('keydown', off);

    return () => {
      node.removeEventListener('pointerenter', onenter);
      node.removeEventListener('pointerleave', off);
      node.removeEventListener('pointerdown', off);
      node.removeEventListener('focus', onfocus);
      node.removeEventListener('blur', off);
      node.removeEventListener('keydown', off);
      hide(node);
    };
  };
}
