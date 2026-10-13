<!--
  Cellule de libellé collante (sticky left) d'une ligne de carte : priorité + type + référence (CODE-n) + titre ;
  icône pause (ambre) si une personne de la ligne est en pause aujourd'hui. Un clic ouvre la carte.
-->
<script lang="ts">
  import CardTypeIcon from '$lib/components/CardTypeIcon.svelte';
  import PriorityBadge from '$lib/components/PriorityBadge.svelte';
  import { board } from '$lib/stores/board.svelte';
  import type { Card } from '$lib/types/Card';
  import { formatShort, toDay } from '$lib/dates';
  import { fmtPct } from '$lib/format';
  import { tooltip } from '$lib/tooltip';
  import { LABEL_WIDTH } from './timeline';

  let {
    card,
    pct = null,
    paused = [],
    indent = false,
    onopen
  }: {
    card: Card;
    pct?: number | null;
    /** Personnes de la ligne en pause aujourd'hui, avec leur premier jour de pause */
    paused?: { userId: number; since: string }[];
    indent?: boolean;
    onopen: () => void;
  } = $props();

  const ref = $derived(board.cardKey(card));
  const type = $derived(board.type(card.type_id));
  /** « Alice en pause depuis le 12 oct. » ; plusieurs personnes : séparées par « · ». */
  const pausedText = $derived(
    paused
      .map((p) => {
        const who = board.member(p.userId)?.display_name ?? 'Ancien membre';
        const since = toDay(p.since);
        return since != null ? `${who} en pause depuis le ${formatShort(since)}` : `${who} en pause`;
      })
      .join(' · ')
  );
</script>

<button class="label" class:indent type="button" style:width="{LABEL_WIDTH}px" title="{ref}{type ? ` · ${type.name}` : ''} · {card.title}" onclick={onopen}>
  <PriorityBadge value={card.priority} />
  <span class="ref num">
    {#if type}<CardTypeIcon icon={type.icon} size={13} label="Type : {type.name}" />{/if}
    {ref}
  </span>
  <span class="title">{card.title}</span>
  {#if pausedText}
    <span class="paused" role="img" aria-label={pausedText} {@attach tooltip(pausedText)}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 4v8M10 4v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </span>
  {/if}
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
    display: inline-flex;
    align-items: center;
    gap: 5px;
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

  /* Ambre discret (priorité P2), comme sur le Kanban. */
  .paused {
    display: inline-flex;
    flex: none;
    color: color-mix(in srgb, var(--p2) 85%, var(--text));
  }

  .pct {
    flex: none;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
