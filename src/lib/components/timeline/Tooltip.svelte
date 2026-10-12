<!--
  Infobulle d'une barre (pointeurs fins). Toujours montée : l'ouverture / fermeture est une transition CSS
  (interruptible) sur opacity + transform, depuis le côté de la barre. `instant` coupe l'animation
  quand une infobulle vient d'être visible (survol d'une barre à l'autre).
-->
<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import CardTypeIcon from '$lib/components/CardTypeIcon.svelte';
  import PriorityBadge from '$lib/components/PriorityBadge.svelte';
  import { toDay } from '$lib/dates';
  import { board } from '$lib/stores/board.svelte';
  import type { Card } from '$lib/types/Card';
  import { fmtEstimate, fmtPct, fmtWorkingDays, NNBSP } from '$lib/format';
  import { formatRange } from './timeline';

  let {
    card,
    userId = null,
    open,
    instant,
    left,
    y,
    below,
    originX
  }: {
    card: Card | null;
    /** Part survolée (carte à plusieurs assignés) : la personne, sa part, son occupation et ses dates */
    userId?: number | null;
    open: boolean;
    instant: boolean;
    left: number;
    /** `top` si `below`, sinon `bottom` (px, viewport) */
    y: number;
    below: boolean;
    originX: number;
  } = $props();

  const cardState = $derived(card ? board.states.find((s) => s.id === card.state_id) : undefined);
  /** Projet affiché dans un pool seulement (une vue projet n'en montre qu'un : la référence suffit). */
  const project = $derived(card && board.kind === 'pool' ? board.projectOf(card.project_id) : undefined);
  const ref = $derived(card ? board.cardKey(card) : '');
  const type = $derived(card ? board.type(card.type_id) : undefined);
  const start = $derived(toDay(card?.schedule?.start));
  const end = $derived(toDay(card?.schedule?.end));
  const person = $derived(userId != null ? card?.assignees.find((a) => a.user_id === userId) : undefined);
  const personName = $derived(person ? (board.member(person.user_id)?.display_name ?? 'Ancien membre') : '');
  const pStart = $derived(toDay(person?.schedule?.start));
  const pEnd = $derived(toDay(person?.schedule?.end));
  const round2 = (n: number) => Math.round(n * 100) / 100;
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
    <div class="ref">
      {#if project}
        <span class="dot" style:background={project.color}></span>
        <span class="project">{project.name}</span>
        <span class="sep" aria-hidden="true">·</span>
      {/if}
      {#if type}<CardTypeIcon icon={type.icon} size={12} />{/if}
      <span class="num">{ref}</span>
      {#if type}
        <span class="sep" aria-hidden="true">·</span>
        <span class="type-name">{type.name}</span>
      {/if}
    </div>
    <div class="title">{card.title}</div>
    <div class="meta">
      <PriorityBadge value={card.priority} showName />
      {#if cardState}
        <span class="state"><span class="dot" style:background={cardState.color}></span>{cardState.name}</span>
      {/if}
    </div>
    {#if person}
      <div class="person">
        <div class="who">
          <Avatar id={person.user_id} name={personName} size={16} />
          <span class="name">{personName}</span>
        </div>
        <span class="sub num">
          {fmtPct(round2(person.pct))}{#if card.estimate_days != null}&nbsp;· {fmtEstimate(
              round2((card.estimate_days * person.pct) / 100)
            )}{/if}&nbsp;· {fmtPct(person.occupancy)} du temps
        </span>
        {#if pStart != null && pEnd != null && person.schedule}
          <div class="when num">
            <span class="dates">{formatRange(pStart, pEnd)}</span>
            <span class="sub">
              {fmtWorkingDays(person.schedule.working_days)}{#if !person.start_date}&nbsp;· date de la carte{/if}
            </span>
          </div>
        {/if}
      </div>
      {#if start != null && end != null && card.schedule}
        <div class="sub num card-span">
          Carte{NNBSP}: {formatRange(start, end)}{#if card.estimate_days != null}&nbsp;· {fmtEstimate(card.estimate_days)}{/if}
        </div>
      {/if}
    {:else}
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
              <span class="pct num">{fmtPct(round2(a.pct))}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="sub">Non assigné</div>
      {/if}
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

  /* Projet et référence au-dessus du titre, discrets : un repère, pas le sujet. */
  .ref {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-bottom: -4px;
    color: var(--text-muted);
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
  }

  .type-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sep {
    flex: none;
    color: var(--text-subtle);
  }

  .ref .num {
    flex: none;
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

  /* Part survolée : la personne d'abord, ses chiffres et ses dates groupés dessous. */
  .person {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }

  .card-span {
    margin-top: -2px;
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
