<!-- Cellule de libellé collante (sticky left) d'une ligne de carte : priorité + référence (CODE-n) + titre ; un clic ouvre la carte. -->
<script lang="ts">
  import PriorityBadge from '$lib/components/PriorityBadge.svelte';
  import { board } from '$lib/stores/board.svelte';
  import type { Card } from '$lib/types/Card';
  import { fmtPct } from '$lib/format';
  import { tooltip } from '$lib/tooltip';
  import { LABEL_WIDTH } from './timeline';

  let {
    card,
    pct = null,
    indent = false,
    onopen
  }: { card: Card; pct?: number | null; indent?: boolean; onopen: () => void } = $props();

  const ref = $derived(board.cardKey(card));
</script>

<button class="label" class:indent type="button" style:width="{LABEL_WIDTH}px" title="{ref} · {card.title}" onclick={onopen}>
  <PriorityBadge value={card.priority} />
  <span class="ref num">{ref}</span>
  <span class="title">{card.title}</span>
  {#if pct != null}
    <span class="pct num" {@attach tooltip('Part de la charge')}>{fmtPct(pct)}</span>
  {/if}
</button>

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
    padding: 0 12px;
    border: 0;
    border-right: 1px solid var(--border);
    background: var(--label-bg, var(--surface));
    color: var(--text);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  /* Aligné sur la pastille / l'avatar de l'en-tête de groupe (12 + chevron 12 + 8). */
  .indent {
    padding-left: 32px;
  }

  .label:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* Référence en retrait : un repère, le titre reste ce qu'on lit. */
  .ref {
    flex: none;
    color: var(--text-muted);
    font-size: 11.5px;
    font-weight: 500;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pct {
    flex: none;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
