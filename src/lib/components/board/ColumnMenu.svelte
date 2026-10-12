<!-- Menu « … » d'une colonne : renommer, couleur, supprimer (seulement si vide, avec confirmation). -->
<script lang="ts">
  import { board } from '$lib/stores/board.svelte';
  import type { State } from '$lib/types/State';
  import { PALETTE } from './palette';
  import Popover from './Popover.svelte';
  import { tooltip } from '$lib/tooltip';

  let { column, cardCount, onrename }: { column: State; cardCount: number; onrename: () => void } = $props();

  const uid = $props.id();
  const menuId = `col-menu-${uid}`;
  let menu: Popover;
  let confirming = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const locked = $derived(cardCount > 0);

  function rename() {
    menu.hide();
    onrename();
  }

  function pick(color: string) {
    menu.hide();
    if (color !== column.color.toLowerCase()) board.updateState(column.id, { color });
  }

  function remove() {
    if (locked) return;
    if (!confirming) {
      confirming = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = false), 3000);
      return;
    }
    clearTimeout(confirmTimer);
    menu.hide();
    board.deleteState(column.id);
  }

  function onclose() {
    clearTimeout(confirmTimer);
    confirming = false;
  }
</script>

<button
  class="btn btn-ghost btn-sm btn-icon trigger"
  type="button"
  popovertarget={menuId}
  aria-label="Actions de la colonne {column.name}"
  {@attach tooltip('Actions de la colonne')}
>
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
  </svg>
</button>

<Popover bind:this={menu} id={menuId} label="Actions de la colonne {column.name}" align="end" minWidth={212} {onclose}>
  <button class="mi" type="button" role="menuitem" onclick={rename}>
    <svg class="mi-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" />
    </svg>
    Renommer
  </button>

  <div class="sep" role="separator"></div>
  <div class="group-label" id="{menuId}-colors">Couleur</div>
  <div class="swatches" role="group" aria-labelledby="{menuId}-colors">
    {#each PALETTE as c (c.value)}
      {@const active = c.value === column.color.toLowerCase()}
      <button
        class="swatch"
        type="button"
        role="menuitemradio"
        aria-checked={active}
        aria-label={c.name}
        style:--c={c.value}
        onclick={() => pick(c.value)}
        {@attach tooltip(c.name)}
      >
        {#if active}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 5.2l2 2 4-4.4" stroke="white" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {/if}
      </button>
    {/each}
  </div>

  <div class="sep" role="separator"></div>
  <button
    class="mi danger"
    class:confirm={confirming}
    type="button"
    role="menuitem"
    aria-disabled={locked}
    aria-describedby={locked ? `${menuId}-locked` : undefined}
    onclick={remove}
  >
    <svg class="mi-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" />
    </svg>
    {confirming ? 'Confirmer la suppression' : 'Supprimer la colonne'}
  </button>
  {#if locked}
    <p class="locked" id="{menuId}-locked">Déplacez ou supprimez d’abord ses {cardCount} carte{cardCount > 1 ? 's' : ''}.</p>
  {/if}
</Popover>

<style>
  .trigger {
    flex: none;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
    padding: 2px 6px 6px;
  }

  .swatch {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--c);
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
    transition: transform var(--dur-press) var(--ease-out);
  }

  .swatch:active {
    transform: scale(0.95);
  }

  .swatch[aria-checked='true'] {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3.5px var(--c);
  }

  .swatch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (hover: hover) and (pointer: fine) {
    .swatch:hover {
      transform: scale(1.1);
    }
    .swatch:active {
      transform: scale(0.95);
    }
  }

  .mi.danger.confirm {
    background: var(--danger-soft);
    font-weight: 500;
  }

  .locked {
    margin: 0;
    padding: 0 8px 6px 32px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .swatch:active,
    .swatch:hover {
      transform: none;
    }
  }
</style>
