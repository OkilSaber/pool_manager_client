<!--
  Glyphe d'un type de carte qui ouvre la grille des 20 glyphes (popover natif, top layer : passe au-dessus des modales).
  Grille 5 × 4 : ←/→ d'un glyphe, ↑/↓ d'une ligne, Début/Fin ; ouverte au clavier, le focus va au glyphe courant.
  Choisir un glyphe referme le menu et rend le focus au déclencheur.
-->
<script lang="ts">
  import CardTypeIcon from '$lib/components/CardTypeIcon.svelte';
  import { iconLabel } from '$lib/cardTypes';
  import { tooltip } from '$lib/tooltip';
  import { ICONS } from '$lib/types/icons';
  import Popover from './Popover.svelte';

  let {
    value,
    label,
    onpick,
    disabled = false
  }: {
    value: string;
    /** Nom accessible du déclencheur, ex. « Glyphe du type Bogue ». */
    label: string;
    onpick: (icon: string) => void;
    disabled?: boolean;
  } = $props();

  const COLS = 5;

  const uid = $props.id();
  const menuId = `icon-${uid}`;
  let menu = $state<Popover>();
  let trigger = $state<HTMLButtonElement>();
  let grid = $state<HTMLDivElement>();

  function buttons(): HTMLButtonElement[] {
    return grid ? Array.from(grid.querySelectorAll<HTMLButtonElement>('button')) : [];
  }

  function pick(icon: string) {
    menu?.hide();
    trigger?.focus({ preventScroll: true });
    if (icon !== value) onpick(icon);
  }

  function onopen() {
    // Après le placement du popover (qui, au clavier, met le focus sur le premier glyphe) : on le passe au glyphe courant.
    requestAnimationFrame(() => {
      if (!grid?.contains(document.activeElement)) return;
      buttons()[Math.max(0, ICONS.indexOf(value as (typeof ICONS)[number]))]?.focus();
    });
  }

  function onkeydown(e: KeyboardEvent) {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(list.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (e.key === 'ArrowDown') next = i + COLS < list.length ? i + COLS : i % COLS;
    else if (e.key === 'ArrowUp') next = i - COLS >= 0 ? i - COLS : i + COLS * Math.floor((list.length - 1 - i) / COLS);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    // Navigation 2D : le parcours linéaire du popover ne s'applique pas.
    e.preventDefault();
    e.stopPropagation();
    list[next]?.focus();
  }
</script>

{#if disabled}
  <span class="glyph static" aria-hidden="true"><CardTypeIcon icon={value} size={16} /></span>
{:else}
  <button
    bind:this={trigger}
    class="glyph trigger"
    type="button"
    popovertarget={menuId}
    aria-label="{label} ({iconLabel(value)})"
    {@attach tooltip('Glyphe')}
  >
    <CardTypeIcon icon={value} size={16} />
  </button>

  <Popover bind:this={menu} id={menuId} {label} minWidth={0} {onopen}>
    <!-- Navigation 2D déléguée aux glyphes (boutons) du groupe, pas une interaction propre au <div>. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="grid" role="group" aria-label="Glyphes" bind:this={grid} {onkeydown}>
      {#each ICONS as icon (icon)}
        {@const active = icon === value}
        <button
          class="cell"
          type="button"
          role="menuitemradio"
          aria-checked={active}
          aria-label={iconLabel(icon)}
          tabindex="-1"
          onclick={() => pick(icon)}
          {@attach tooltip(iconLabel(icon))}
        >
          <CardTypeIcon {icon} size={16} />
        </button>
      {/each}
    </div>
  </Popover>
{/if}

<style>
  .glyph {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
  }

  .trigger {
    cursor: pointer;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-hover) ease,
      border-color var(--dur-hover) ease,
      color var(--dur-hover) ease;
  }

  .trigger:active {
    transform: scale(0.95);
  }

  .trigger:focus-visible {
    outline: none;
    box-shadow: var(--focus);
    color: var(--text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(5, 30px);
    gap: 2px;
    padding: 2px;
  }

  .cell {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: transform var(--dur-press) var(--ease-out);
  }

  .cell:active {
    transform: scale(0.95);
  }

  .cell:focus-visible {
    outline: none;
    background: var(--surface-3);
    color: var(--text);
  }

  .cell[aria-checked='true'] {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  @media (hover: hover) and (pointer: fine) {
    .trigger:hover {
      border-color: var(--border);
      background: var(--surface);
      color: var(--text);
    }
    .cell:not([aria-checked='true']):hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .trigger:active,
    .cell:active {
      transform: none;
    }
  }
</style>
