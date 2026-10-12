<!--
  Choix du type d'une carte : menu déroulant maison (un <select> natif ne peut pas montrer les glyphes).
  « Aucun type » puis les types dans leur ordre. Clavier : Entrée / Espace / ↓ / ↑ ouvrent le menu sur le choix
  courant ; ↑/↓, Début/Fin s'y déplacent ; Entrée choisit ; Échap referme (le focus revient au champ).
-->
<script lang="ts">
  import CardTypeIcon from '$lib/components/CardTypeIcon.svelte';
  import type { CardType } from '$lib/types/CardType';
  import Popover from './Popover.svelte';

  let {
    value,
    types,
    labelledby,
    onchange
  }: {
    value: number | null;
    types: CardType[];
    /** id du libellé « Type » du champ */
    labelledby: string;
    onchange: (typeId: number | null) => void;
  } = $props();

  const uid = $props.id();
  const menuId = `type-${uid}`;
  const valueId = `type-value-${uid}`;
  let menu = $state<Popover>();
  let trigger = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();

  /** Type inconnu (supprimé entre-temps) : affiché comme « Aucun type ». */
  const current = $derived(value == null ? undefined : types.find((t) => t.id === value));

  function pick(id: number | null) {
    menu?.hide();
    trigger?.focus({ preventScroll: true });
    if (id !== (current?.id ?? null)) onchange(id);
  }

  function onopen() {
    // Après le placement (qui, au clavier, met le focus sur la première option) : focus sur le choix courant.
    requestAnimationFrame(() => {
      if (!list?.contains(document.activeElement)) return;
      list.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
  }

  function ontriggerkey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const pop = document.getElementById(menuId);
    if (pop && !pop.matches(':popover-open')) pop.showPopover();
  }
</script>

<button
  bind:this={trigger}
  class="select trigger"
  type="button"
  popovertarget={menuId}
  aria-haspopup="menu"
  aria-labelledby="{labelledby} {valueId}"
  onkeydown={ontriggerkey}
>
  <span class="value" id={valueId}>
    {#if current}
      <CardTypeIcon icon={current.icon} />
      <span class="name">{current.name}</span>
    {:else}
      <span class="none-glyph" aria-hidden="true"></span>
      <span class="name muted">Aucun type</span>
    {/if}
  </span>
</button>

<Popover bind:this={menu} id={menuId} label="Type de la carte" minWidth={212} {onopen}>
  <div class="options" bind:this={list}>
    <button class="mi" type="button" role="menuitemradio" aria-checked={current == null} onclick={() => pick(null)}>
      <span class="none-glyph" aria-hidden="true"></span>
      <span class="name muted">Aucun type</span>
      {@render check(current == null)}
    </button>
    {#if types.length}
      <div class="sep" role="separator"></div>
    {/if}
    {#each types as t (t.id)}
      {@const on = current?.id === t.id}
      <button class="mi" type="button" role="menuitemradio" aria-checked={on} onclick={() => pick(t.id)}>
        <CardTypeIcon icon={t.icon} />
        <span class="name">{t.name}</span>
        {@render check(on)}
      </button>
    {/each}
  </div>
</Popover>

{#snippet check(on: boolean)}
  {#if on}
    <svg class="check" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  {/if}
{/snippet}

<style>
  .trigger {
    display: flex;
    align-items: center;
    text-align: left;
  }

  .value {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted);
  }

  /* « Aucun type » : un emplacement vide en pointillés, à la taille d'un glyphe. */
  .none-glyph {
    flex: none;
    width: 12px;
    height: 12px;
    margin: 1px;
    border: 1.5px dashed var(--border-strong);
    border-radius: 3px;
  }

  .options {
    max-height: 320px;
    overflow-y: auto;
  }

  .check {
    flex: none;
    margin-left: auto;
    color: var(--accent);
  }
</style>
