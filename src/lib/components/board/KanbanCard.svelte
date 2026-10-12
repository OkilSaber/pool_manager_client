<!--
  Rendu d'une carte du Kanban (présentation seule : le clic, le clavier et le glisser sont gérés
  par l'emplacement parent dans KanbanColumn).
-->
<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import PriorityBadge from '$lib/components/PriorityBadge.svelte';
  import { dayOfMonth, formatShort, toDay } from '$lib/dates';
  import { board } from '$lib/stores/board.svelte';
  import type { Card } from '$lib/types/Card';
  import { fmtEstimate, fmtPct, fmtWorkingDays } from '$lib/format';
  import { tooltip } from '$lib/tooltip';

  let { card }: { card: Card } = $props();

  const MAX_AVATARS = 3;

  const people = $derived(
    card.assignees.map((a) => {
      const m = board.member(a.user_id);
      return { id: a.user_id, name: m?.display_name ?? 'Membre retiré', pct: a.pct };
    })
  );
  const extra = $derived(Math.max(0, people.length - MAX_AVATARS));
  const share = (p: { name: string; pct: number }) => `${p.name} · ${fmtPct(p.pct)}`;

  const span = $derived.by(() => {
    const s = card.schedule;
    if (!s) return null;
    const start = toDay(s.start);
    const end = toDay(s.end);
    if (start == null || end == null) return null;
    let text: string;
    if (start === end) text = formatShort(start);
    else if (s.start.slice(0, 7) === s.end.slice(0, 7)) text = `${dayOfMonth(start)} → ${formatShort(end)}`;
    else text = `${formatShort(start)} → ${formatShort(end)}`;
    return { text, title: `Du ${formatShort(start)} au ${formatShort(end)} · ${fmtWorkingDays(s.working_days)}` };
  });

  const hasDescription = $derived(card.description.trim().length > 0);
  const hasMeta = $derived(card.estimate_days != null || span != null || people.length > 0);

  // Référence `CODE-n` ; en vue pool, avec la pastille du projet (les cartes de plusieurs projets s'y mêlent).
  const project = $derived(board.projectOf(card.project_id));
  const key = $derived(board.cardKey(card));
  const inPool = $derived(board.kind === 'pool');
</script>

<article class="card">
  <div class="top">
    <PriorityBadge value={card.priority} />
    <span class="key num" class:pool={inPool} {@attach tooltip(inPool && project ? project.name : null)}>
      {#if inPool && project}<span class="key-dot" style:background={project.color} aria-hidden="true"></span>{/if}
      {key}
    </span>
    {#if hasDescription}
      <svg class="desc-icon" width="14" height="14" viewBox="0 0 16 16" aria-label="Contient une description" role="img">
        <path d="M3 4.5h10M3 8h10M3 11.5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none" />
      </svg>
    {/if}
  </div>

  <p class="title" title={card.title.length > 80 ? card.title : undefined}>{card.title}</p>

  {#if hasMeta}
    <div class="meta">
      {#if card.estimate_days != null}
        <span class="chip num" {@attach tooltip('Chiffrage')}>{fmtEstimate(card.estimate_days)}</span>
      {/if}
      {#if span}
        <span class="chip num" {@attach tooltip(span.title)}>
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="3.5" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.3" fill="none" />
            <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          {span.text}
        </span>
      {/if}
      {#if people.length}
        <span class="people" aria-label="Assignés : {people.map(share).join(', ')}">
          {#each people.slice(0, MAX_AVATARS) as p (p.id)}
            <span class="person" {@attach tooltip(share(p))}>
              <Avatar id={p.id} name={p.name} size={20} ring />
            </span>
          {/each}
          {#if extra}
            <span class="more num" {@attach tooltip(people.slice(MAX_AVATARS).map(share).join(', '))}>+{extra}</span>
          {/if}
        </span>
      {/if}
    </div>
  {/if}
</article>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    transition:
      transform var(--dur-press) var(--ease-out),
      border-color var(--dur-hover) ease;
  }

  /* Ombre portée « soulevée » sur un pseudo-élément : on n'anime que son opacité. */
  .card::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    box-shadow: var(--shadow-lg);
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms var(--ease-out);
  }

  .card:active {
    transform: scale(0.98);
  }

  /*
   * Sombre : la carte doit monter d'un cran au-dessus de la colonne (≈ --surface en sombre).
   * On redéfinit --surface localement pour que les anneaux des avatars et du « +n » suivent le fond.
   */
  @media (prefers-color-scheme: dark) {
    .card {
      --surface: var(--surface-2);
    }
  }

  @media (hover: hover) and (pointer: fine) {
    .card:hover {
      border-color: var(--border-strong);
    }
  }

  .top {
    display: flex;
    align-items: center;
    min-height: 20px;
  }

  .desc-icon {
    flex: none;
    color: var(--text-subtle);
  }

  .key {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin-left: auto;
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--text-subtle);
    white-space: nowrap;
  }

  .key.pool {
    color: var(--text-muted);
  }

  .key + .desc-icon {
    margin-left: 6px;
  }

  .key-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 999px;
  }

  .title {
    margin: 0;
    font-size: 13.5px;
    font-weight: 500;
    line-height: 1.4;
    color: var(--text);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 8px;
    min-height: 20px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .chip svg {
    color: var(--text-subtle);
  }

  .people {
    display: inline-flex;
    align-items: center;
    margin-left: auto;
    padding-left: 4px;
  }

  .person + .person,
  .person + .more {
    margin-left: -5px;
  }

  /* Le survol cible l'enveloppe (infobulle « Nom · 60 % ») et neutralise le title natif de l'avatar. */
  .person :global(*) {
    pointer-events: none;
  }

  .person {
    display: inline-flex;
    border-radius: 999px;
  }

  .more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--surface-3);
    box-shadow: 0 0 0 2px var(--surface);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-muted);
  }

  /* ---------- Pendant le glisser (clone créé par svelte-dnd-action) ---------- */

  :global(#dnd-action-dragged-el) > .card {
    transform: rotate(1.5deg);
    border-color: var(--border-strong);
    transition:
      transform 150ms var(--ease-out),
      border-color 150ms ease;
  }

  :global(#dnd-action-dragged-el) > .card::after {
    opacity: 1;
  }

  @starting-style {
    :global(#dnd-action-dragged-el) > .card {
      transform: none;
    }
    :global(#dnd-action-dragged-el) > .card::after {
      opacity: 0;
    }
  }

  /* Relâché : la carte se repose pendant qu'elle rejoint son emplacement. */
  :global(#dnd-action-dragged-el[data-dropping]) > .card {
    transform: none;
    transition-duration: 180ms;
  }

  :global(#dnd-action-dragged-el[data-dropping]) > .card::after {
    opacity: 0;
    transition-duration: 180ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .card:active,
    :global(#dnd-action-dragged-el) > .card {
      transform: none;
    }
  }
</style>
