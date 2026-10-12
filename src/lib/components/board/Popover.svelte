<!--
  Menu flottant sur l'API Popover native : top layer (jamais rogné par un conteneur qui défile,
  passe au-dessus des modales), fermeture au clic extérieur et Échap gérées par le navigateur.
  Le déclencheur est un <button popovertarget={id}>.
  Mouvement : apparaît depuis son déclencheur (transform-origin du côté du bouton), 150 ms ease-out,
  sortie plus courte ; rien du tout si ouvert au clavier.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { lastInputWasKeyboard } from '$lib/modality';

  let {
    id,
    label,
    align = 'start',
    minWidth = 184,
    role = 'menu',
    children,
    onopen,
    onclose
  }: {
    id: string;
    label: string;
    align?: 'start' | 'end';
    minWidth?: number;
    role?: 'menu' | 'dialog';
    children: Snippet;
    onopen?: () => void;
    onclose?: () => void;
  } = $props();

  let el: HTMLDivElement;
  let frame = 0;

  export function hide() {
    if (el?.matches(':popover-open')) el.hidePopover();
  }

  function invoker(): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[popovertarget="${CSS.escape(id)}"]`);
  }

  function items(): HTMLElement[] {
    return Array.from(el.querySelectorAll<HTMLElement>('[role^="menuitem"], [data-autofocus]'));
  }

  function place(focusFirst: boolean) {
    const t = invoker();
    if (!t || !el.matches(':popover-open')) return;
    const r = t.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = r.bottom + 4 + h <= window.innerHeight - 8 || r.top - 4 - h < 8;
    const top = below ? r.bottom + 4 : r.top - 4 - h;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${left}px`;
    el.style.transformOrigin = `${below ? 'top' : 'bottom'} ${align === 'end' ? 'right' : 'left'}`;
    if (focusFirst) items()[0]?.focus();
  }

  function onbeforetoggle(e: ToggleEvent) {
    const kbd = lastInputWasKeyboard();
    el.toggleAttribute('data-instant', kbd);
    if (e.newState === 'open') {
      // Mesure et placement juste avant la première peinture (le popover n'est affiché qu'après cet évènement).
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(kbd));
    }
  }

  function onscroll(e: Event) {
    if (!(e.target instanceof Node) || !el.contains(e.target)) hide();
  }

  function ontoggle(e: ToggleEvent) {
    if (e.newState === 'open') {
      window.addEventListener('scroll', onscroll, true);
      window.addEventListener('resize', hide);
      onopen?.();
    } else {
      window.removeEventListener('scroll', onscroll, true);
      window.removeEventListener('resize', hide);
      onclose?.();
    }
  }

  $effect(() => () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', onscroll, true);
    window.removeEventListener('resize', hide);
  });

  function onkeydown(e: KeyboardEvent) {
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = i < 0 ? 0 : (i + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    // Les flèches gauche/droite restent à l'éditeur quand un champ a le focus.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    list[next].focus();
  }
</script>

<div
  bind:this={el}
  {id}
  class="pop"
  popover="auto"
  {role}
  aria-label={label}
  style:min-width="{minWidth}px"
  {onbeforetoggle}
  {ontoggle}
  {onkeydown}
>
  {@render children()}
</div>

<style>
  .pop {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    overflow: visible;
    opacity: 1;
    transform: none;
    transition:
      opacity 150ms var(--ease-out),
      transform 150ms var(--ease-out),
      overlay 150ms allow-discrete,
      display 150ms allow-discrete;
  }

  /* Sortie plus courte que l'entrée */
  .pop:not(:popover-open) {
    opacity: 0;
    transform: scale(0.98);
    transition-duration: 100ms;
  }

  @starting-style {
    .pop:popover-open {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  /* Ouvert / fermé au clavier : instantané */
  .pop:global([data-instant]) {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .pop,
    .pop:not(:popover-open) {
      transform: none;
    }
    @starting-style {
      .pop:popover-open {
        transform: none;
      }
    }
  }

  /* ---------- Éléments de menu (rendus par les composants appelants) ---------- */

  .pop :global(.mi) {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pop :global(.mi:focus-visible) {
    outline: none;
    background: var(--surface-3);
  }

  .pop :global(.mi.danger) {
    color: var(--danger);
  }

  /* Après .danger (même spécificité) : un « Supprimer » verrouillé ne doit pas rester rouge. */
  .pop :global(.mi[aria-disabled='true']) {
    color: var(--text-subtle);
    cursor: default;
  }

  .pop :global(.mi .mi-icon) {
    flex: none;
    width: 16px;
    color: var(--text-muted);
  }

  /* L'icône suit le ton de l'élément (rouge pour une action destructive, estompée si désactivée). */
  .pop :global(.mi.danger .mi-icon),
  .pop :global(.mi[aria-disabled='true'] .mi-icon) {
    color: inherit;
  }

  .pop :global(.mi .mi-hint) {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-subtle);
  }

  .pop :global(.sep) {
    height: 1px;
    margin: 4px -4px;
    background: var(--border);
  }

  .pop :global(.group-label) {
    padding: 6px 8px 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-subtle);
  }

  @media (hover: hover) and (pointer: fine) {
    .pop :global(.mi:not([aria-disabled='true']):hover) {
      background: var(--surface-2);
    }
    .pop :global(.mi.danger:not([aria-disabled='true']):hover) {
      background: var(--danger-soft);
    }
  }
</style>
