<!--
  Infobulle d'une barre (pointeurs fins). Toujours montée : l'ouverture / fermeture est une transition CSS
  (interruptible) sur opacity + transform, depuis le côté de la barre. `instant` coupe l'animation
  quand une infobulle vient d'être visible (survol d'une barre à l'autre).
-->
<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import PriorityBadge from '$lib/components/PriorityBadge.svelte';
  import { toDay } from '$lib/dates';
  import { board } from '$lib/stores/board.svelte';
  import type { Card } from '$lib/types/Card';
  import { fmtEstimate, fmtPct, fmtWorkingDays } from '$lib/format';
  import { formatRange } from './timeline';

  let {
    card,
    open,
    instant,
    left,
    y,
    below,
    originX
  }: {
    card: Card | null;
    open: boolean;
    instant: boolean;
    left: number;
    /** `top` si `below`, sinon `bottom` (px, viewport) */
    y: number;
    below: boolean;
    originX: number;
  } = $props();

  const cardState = $derived(card ? board.states.find((s) => s.id === card.state_id) : undefined);
  const start = $derived(toDay(card?.schedule?.start));
  const end = $derived(toDay(card?.schedule?.end));
</script>

<div
  class="tip"
  aria-hidden="true"
  data-open={open || undefined}
  data-instant={instant || undefined}
  style:left="{left}px"
  style:top={below ? `${y}px` : undefined}
  style:bottom={below ? undefined : `${y}px`}
  style:transform-origin="{originX}px {below ? 'top' : 'bottom'}"
>
  {#if card}
    <div class="title">{card.title}</div>
    <div class="meta">
      <PriorityBadge value={card.priority} showName />
      {#if cardState}
        <span class="state"><span class="dot" style:background={cardState.color}></span>{cardState.name}</span>
      {/if}
    </div>
    {#if start != null && end != null && card.schedule}
      <div class="when num">
        <span class="dates">{formatRange(start, end)}</span>
        <span class="sub">
          {fmtWorkingDays(card.schedule.working_days)}{#if card.estimate_days != null}&nbsp;· {fmtEstimate(card.estimate_days)}{/if}
        </span>
      </div>
    {/if}
    {#if card.assignees.length}
      <ul class="people">
        {#each card.assignees as a (a.user_id)}
          {@const name = board.member(a.user_id)?.display_name ?? 'Ancien membre'}
          <li>
            <Avatar id={a.user_id} {name} size={16} />
            <span class="name">{name}</span>
            <span class="pct num">{fmtPct(a.pct)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="sub">Non assigné</div>
    {/if}
  {/if}
</div>

<style>
  .tip {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 220px;
    max-width: 300px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    font-size: 12.5px;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.97);
    /* Fermeture plus rapide que l'ouverture */
    transition:
      opacity 100ms var(--ease-out),
      transform 100ms var(--ease-out);
  }

  .tip[data-open] {
    opacity: 1;
    transform: none;
    transition-duration: 125ms;
  }

  .tip[data-instant] {
    transition-duration: 0ms;
  }

  /* Titre long : 3 lignes au plus, l'infobulle reste un aperçu. */
  .title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 999px;
  }

  /* Dates + durée groupées (écart serré) plutôt qu'une marge négative. */
  .when {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dates {
    color: var(--text);
  }

  .sub {
    color: var(--text-muted);
  }

  .people {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--border);
    list-style: none;
  }

  .people li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pct {
    color: var(--text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .tip {
      transform: none;
    }
  }
</style>
