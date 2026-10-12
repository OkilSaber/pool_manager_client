<!--
  En-tête de groupe repliable : chevron, pastille (état) ou avatar (assigné), nom, nombre de cartes, charge.
  Dans la grille, une fine bande résume l'étendue du groupe (du premier début à la dernière fin).
-->
<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import { fmtEstimate } from '$lib/format';
  import { tooltip } from '$lib/tooltip';
  import { LABEL_WIDTH, plural } from './timeline';

  let {
    kind,
    label,
    count,
    load = null,
    color = null,
    userId = null,
    spanStart = null,
    spanEnd = null,
    rangeStart,
    dayWidth,
    collapsed,
    ontoggle
  }: {
    kind: 'state' | 'assignee' | 'unplanned';
    label: string;
    count: number;
    load?: number | null;
    color?: string | null;
    userId?: number | null;
    spanStart?: number | null;
    spanEnd?: number | null;
    rangeStart: number;
    dayWidth: number;
    collapsed: boolean;
    ontoggle: () => void;
  } = $props();

  // Activation clavier (detail === 0) : pas d'animation du chevron.
  let viaKeyboard = $state(false);

  const loadTitle = $derived(kind === 'assignee' ? 'Charge de la personne (sa part des chiffrages)' : 'Charge totale');
  /** Nom lu par les lecteurs d'écran (sinon « Backlog 3 8 j/h ») ; les infobulles ne sont que visuelles. */
  const a11yLabel = $derived(
    `${label}, ${plural(count, 'carte', 'cartes')}` + (load != null ? `, charge ${fmtEstimate(load)}` : '')
  );
</script>

<button
  class="label"
  type="button"
  style:width="{LABEL_WIDTH}px"
  aria-expanded={!collapsed}
  aria-label={a11yLabel}
  data-kbd={viaKeyboard || undefined}
  onclick={(e) => {
    viaKeyboard = e.detail === 0;
    ontoggle();
  }}
>
  <svg class="chev" class:collapsed width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  {#if kind === 'state'}
    <span class="dot" style:background={color ?? 'var(--text-subtle)'} aria-hidden="true"></span>
  {:else if kind === 'assignee'}
    {#if userId != null}
      <Avatar id={userId} name={label} size={18} />
    {:else}
      <span class="nobody" aria-hidden="true"></span>
    {/if}
  {:else}
    <!-- « Non planifiées » : un calendrier, pas le cercle « personne » (qui signifie « Non assigné »). -->
    <svg class="glyph" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  {/if}
  <span class="name" title={label}>{label}</span>
  <span class="count num" {@attach tooltip('Nombre de cartes')}>{count}</span>
  {#if load != null}
    <span class="load num" {@attach tooltip(loadTitle)}>{fmtEstimate(load)}</span>
  {/if}
</button>
<div class="track">
  {#if spanStart != null && spanEnd != null}
    <span
      class="span"
      style:left="{(spanStart - rangeStart) * dayWidth}px"
      style:width="{(spanEnd - spanStart + 1) * dayWidth}px"
      style:--c={color ?? 'var(--text-subtle)'}
      aria-hidden="true"
    ></span>
  {/if}
</div>

<style>
  .label {
    position: sticky;
    left: 0;
    z-index: 3;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    /* 12 + chevron 12 + écart 8 = 32 px : la pastille s'aligne sur le badge des lignes (retrait 32 px). */
    padding: 0 12px;
    border: 0;
    border-right: 1px solid var(--border);
    background: var(--group-bg);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .label:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .chev {
    flex: none;
    color: var(--text-subtle);
    transition: transform 150ms var(--ease-out);
  }

  .chev.collapsed {
    transform: rotate(-90deg);
  }

  [data-kbd] .chev {
    transition: none;
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 999px;
  }

  .glyph {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    color: var(--text-subtle);
  }

  .nobody {
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 999px;
    border: 1.5px dashed var(--border-strong);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
  }

  .load {
    flex: none;
    margin-left: auto;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }

  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
  }

  .span {
    position: absolute;
    top: 50%;
    height: 4px;
    margin-top: -2px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--c) 45%, transparent);
  }

  @media (hover: hover) and (pointer: fine) {
    .label:hover .chev {
      color: var(--text);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
