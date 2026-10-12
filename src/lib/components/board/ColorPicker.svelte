<!--
  Pastille de couleur qui ouvre la palette des colonnes (popover natif, top layer : passe au-dessus des modales).
  Choisir une couleur referme le menu et rend le focus à la pastille.
-->
<script lang="ts">
  import { PALETTE } from './palette';
  import Popover from './Popover.svelte';
  import { tooltip } from '$lib/tooltip';

  let {
    value,
    label,
    onpick,
    disabled = false,
    size = 18
  }: {
    value: string;
    /** Nom accessible du déclencheur, ex. « Couleur de la colonne À faire ». */
    label: string;
    onpick: (color: string) => void;
    disabled?: boolean;
    size?: number;
  } = $props();

  const uid = $props.id();
  const menuId = `color-${uid}`;
  let menu = $state<Popover>();
  let trigger = $state<HTMLButtonElement>();

  const current = $derived(value.toLowerCase());
  const currentName = $derived(PALETTE.find((c) => c.value === current)?.name);

  function pick(color: string) {
    menu?.hide();
    trigger?.focus({ preventScroll: true });
    if (color !== current) onpick(color);
  }
</script>

{#if disabled}
  <span class="dot" style:--c={value} style:--s="{size}px" aria-hidden="true"></span>
{:else}
  <button
    bind:this={trigger}
    class="dot trigger"
    type="button"
    style:--c={value}
    style:--s="{size}px"
    popovertarget={menuId}
    aria-label="{label}{currentName ? ` (${currentName})` : ''}"
    {@attach tooltip('Couleur')}
  ></button>

  <Popover bind:this={menu} id={menuId} {label} minWidth={0}>
    <div class="swatches" role="group" aria-label="Couleurs">
      {#each PALETTE as c (c.value)}
        {@const active = c.value === current}
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
  </Popover>
{/if}

<style>
  .dot {
    display: block;
    flex: none;
    width: var(--s);
    height: var(--s);
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.1);
  }

  .trigger {
    cursor: pointer;
    transition: transform var(--dur-press) var(--ease-out);
  }

  .trigger:active {
    transform: scale(0.92);
  }

  .trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(4, 20px);
    gap: 6px;
    padding: 6px;
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
    .trigger:hover,
    .swatch:hover {
      transform: scale(1.1);
    }
    .trigger:active,
    .swatch:active {
      transform: scale(0.95);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .trigger,
    .swatch {
      transition: none;
    }
    .trigger:hover,
    .trigger:active,
    .swatch:hover,
    .swatch:active {
      transform: none;
    }
  }
</style>
