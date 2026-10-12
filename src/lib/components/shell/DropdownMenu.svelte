<!--
  Menu déroulant ancré à son déclencheur (motif « menu button » WAI-ARIA).

  - Le popover grandit depuis le coin du déclencheur (transform-origin), scale(0.97) + opacité,
    entrée ~150 ms en ease-out fort, sortie plus courte.
  - Ouvert/fermé au clavier (Entrée, Espace, flèches, Échap) : aucune animation — une action
    clavier doit être instantanée.
  - Ouvert à la souris : le focus va sur le conteneur du menu (pas d'anneau parasite sur le
    premier élément) ; ouvert au clavier : focus sur le premier (ou dernier) élément.
  - La surbrillance, c'est le focus : il suit le pointeur (comme un menu natif), donc jamais deux
    lignes en surbrillance quand on alterne souris et flèches.
  - Fermeture : clic à l'extérieur, Échap (focus rendu au déclencheur), Tab, ou sélection.
  - Toujours présent dans le DOM (visibility) : les transitions CSS restent interruptibles
    quand on ouvre/ferme rapidement.

  Usage :
    <DropdownMenu label="…" bind:open>
      {#snippet trigger(props)}<button {...props}>…</button>{/snippet}
      <MenuItem onselect={…}>…</MenuItem>
    </DropdownMenu>
-->
<script lang="ts" module>
  import { getContext, setContext, tick, type Snippet } from 'svelte';

  const KEY = Symbol('dropdown-menu');

  export interface MenuContext {
    /** Ferme le menu (sans animation si l'activation vient du clavier), rend le focus, puis exécute l'action. */
    select: (event: MouseEvent, action?: () => void) => void;
    /** Rend le focus au conteneur du menu (le pointeur a quitté l'élément : plus aucune ligne en surbrillance). */
    release: () => void;
  }

  export function getMenuContext(): MenuContext {
    return getContext<MenuContext>(KEY);
  }

  /** Attributs à étaler sur le bouton déclencheur. */
  export interface TriggerProps {
    id: string;
    type: 'button';
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
    onclick: (event: MouseEvent) => void;
    onkeydown: (event: KeyboardEvent) => void;
  }
</script>

<script lang="ts">
  let {
    open = $bindable(false),
    label,
    align = 'end',
    width = 200,
    trigger,
    header,
    children
  }: {
    open?: boolean;
    /** Nom accessible du menu. */
    label: string;
    /** Bord du déclencheur auquel le menu s'aligne (et d'où il grandit). */
    align?: 'start' | 'end';
    width?: number;
    trigger: Snippet<[TriggerProps]>;
    header?: Snippet;
    children: Snippet;
  } = $props();

  const uid = $props.id();
  const triggerId = `${uid}-trigger`;
  const menuId = `${uid}-menu`;

  let menu: HTMLDivElement;
  let popover: HTMLDivElement;
  /** Vrai quand l'ouverture/fermeture vient du clavier : pas de transition. */
  let instant = $state(false);

  const triggerEl = () => document.getElementById(triggerId);

  function items(): HTMLElement[] {
    return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  }

  async function show(viaKeyboard: boolean, focus: 'menu' | 'first' | 'last') {
    instant = viaKeyboard;
    open = true;
    await tick();
    const list = items();
    if (focus === 'first' && list.length) list[0].focus();
    else if (focus === 'last' && list.length) list[list.length - 1].focus();
    else menu.focus();
  }

  function hide(viaKeyboard: boolean, returnFocus: boolean) {
    if (!open) return;
    instant = viaKeyboard;
    open = false;
    if (returnFocus) triggerEl()?.focus();
  }

  setContext<MenuContext>(KEY, {
    select(event, action) {
      // detail === 0 : clic synthétique déclenché par Entrée/Espace.
      hide(event.detail === 0, true);
      action?.();
    },
    release() {
      if (open) menu.focus({ preventScroll: true });
    }
  });

  const triggerProps: TriggerProps = $derived({
    id: triggerId,
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': menuId,
    onclick: (e: MouseEvent) => {
      const viaKeyboard = e.detail === 0;
      if (open) hide(viaKeyboard, viaKeyboard);
      else show(viaKeyboard, viaKeyboard ? 'first' : 'menu');
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        show(true, e.key === 'ArrowDown' ? 'first' : 'last');
      }
    }
  });

  function move(delta: number | 'first' | 'last') {
    const list = items();
    if (!list.length) return;
    const current = list.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (delta === 'first') next = 0;
    else if (delta === 'last') next = list.length - 1;
    else if (current === -1) next = delta > 0 ? 0 : list.length - 1;
    else next = (current + delta + list.length) % list.length;
    list[next].focus();
  }

  function onkeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        move('first');
        break;
      case 'End':
        e.preventDefault();
        move('last');
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        hide(true, true);
        break;
      case 'Tab':
        // Le focus suit son cours naturel ; le menu se ferme sans animation.
        hide(true, false);
        break;
    }
  }

  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!open || !next) return;
    if (popover.contains(next) || triggerEl()?.contains(next)) return;
    hide(false, false);
  }

  // Clic à l'extérieur (phase de capture : avant que la cible ne réagisse).
  $effect(() => {
    if (!open) return;
    const onpointerdown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popover.contains(target) || triggerEl()?.contains(target)) return;
      hide(false, false);
    };
    document.addEventListener('pointerdown', onpointerdown, true);
    return () => document.removeEventListener('pointerdown', onpointerdown, true);
  });
</script>

<div class="dropdown">
  {@render trigger(triggerProps)}
  <div
    bind:this={popover}
    class="popover"
    class:start={align === 'start'}
    style:width="{width}px"
    data-open={open || undefined}
    data-instant={instant || undefined}
    {onfocusout}
  >
    {#if header}
      <div class="popover-header">{@render header()}</div>
    {/if}
    <div bind:this={menu} id={menuId} class="menu" role="menu" aria-label={label} tabindex="-1" {onkeydown}>
      {@render children()}
    </div>
  </div>
</div>

<style>
  .dropdown {
    position: relative;
    display: inline-flex;
  }

  .popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 40;
    padding: 4px;
    border: 1px solid var(--border);
    /* Rayons concentriques : 6 px (éléments) + 4 px (marge intérieure) */
    border-radius: calc(var(--radius-sm) + 4px);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    /* Grandit depuis le coin du déclencheur */
    transform-origin: top right;

    /* Fermé : sortie courte, puis retiré de l'arbre d'accessibilité et de l'ordre de tabulation */
    opacity: 0;
    transform: scale(0.97);
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity var(--dur-exit) var(--ease-out),
      transform var(--dur-exit) var(--ease-out),
      visibility 0s linear var(--dur-exit);
  }

  .popover.start {
    right: auto;
    left: 0;
    transform-origin: top left;
  }

  .popover[data-open] {
    opacity: 1;
    transform: none;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity 150ms var(--ease-out),
      transform 150ms var(--ease-out),
      visibility 0s;
  }

  /* Action clavier : instantané */
  .popover[data-instant] {
    transition-duration: 0s;
    transition-delay: 0s;
  }

  .popover-header {
    padding: 8px;
    margin: 0 0 4px;
    border-bottom: 1px solid var(--border);
  }

  .menu {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .menu:focus {
    outline: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .popover,
    .popover[data-open] {
      transform: none;
    }
  }
</style>
