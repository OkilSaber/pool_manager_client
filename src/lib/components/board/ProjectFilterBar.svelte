<!--
  Filtres du tableau (Kanban et Chronologie), chacun mémorisé par le store :
  - par projet (pool d'au moins deux projets actifs) : une pastille par projet actif ;
  - par type (dès qu'un type existe, pool ou projet) : une pastille par type (glyphe + nom), puis « Sans type ».
  Sélection multiple ; « Tous » efface le filtre du groupe. Boutons bascule (aria-pressed) : Tab / Entrée / Espace.
-->
<script lang="ts">
  import CardTypeIcon from '$lib/components/CardTypeIcon.svelte';
  import { NO_TYPE } from '$lib/cardTypes';
  import { board } from '$lib/stores/board.svelte';
  import { tooltip } from '$lib/tooltip';

  const filter = $derived(board.projectFilter);
  const all = $derived(filter.length === 0);

  const counts = $derived.by(() => {
    const m = new Map<number, number>();
    for (const c of board.cards) m.set(c.project_id, (m.get(c.project_id) ?? 0) + 1);
    return m;
  });

  const showProjects = $derived(board.kind === 'pool' && board.activeProjects.length > 1);
  const showTypes = $derived(board.types.length > 0);
  const both = $derived(showProjects && showTypes);

  const typeFilter = $derived(board.typeFilter);
  const allTypes = $derived(typeFilter.length === 0);

  const typeCounts = $derived.by(() => {
    const m = new Map<number, number>();
    for (const c of board.cards) {
      const k = c.type_id ?? NO_TYPE;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  });

  const noTypeOn = $derived(typeFilter.includes(NO_TYPE));
  const noTypeCount = $derived(typeCounts.get(NO_TYPE) ?? 0);

  const cartes = (n: number) => `${n} carte${n > 1 ? 's' : ''}`;

  function toggleType(id: number) {
    const next = typeFilter.includes(id) ? typeFilter.filter((t) => t !== id) : [...typeFilter, id];
    // Tous les types et « Sans type » cochés un à un : équivaut à « Tous ».
    board.setTypeFilter(next.length === board.types.length + 1 ? [] : next);
  }

  function toggle(id: number) {
    const next = filter.includes(id) ? filter.filter((p) => p !== id) : [...filter, id];
    // Tous les projets cochés un à un : équivaut à « Tous ».
    board.setProjectFilter(next.length === board.activeProjects.length ? [] : next);
  }
</script>

<div class="filter-bar">
  {#if showProjects}
    <div class="group" role="group" aria-label="Filtrer par projet">
      {#if both}<span class="group-label" aria-hidden="true">Projets</span>{/if}
      <button class="chip all" type="button" aria-pressed={all} aria-label="Tous les projets" onclick={() => board.setProjectFilter([])}>Tous</button>
      <span class="sep" aria-hidden="true"></span>
      {#each board.activeProjects as p (p.id)}
        {@const on = filter.includes(p.id)}
        {@const n = counts.get(p.id) ?? 0}
        <button
          class="chip"
          class:dim={!all && !on}
          type="button"
          aria-pressed={on}
          aria-label="{p.name} ({p.code}, {n} carte{n > 1 ? 's' : ''})"
          style:--c={p.color}
          onclick={() => toggle(p.id)}
          {@attach tooltip(`${p.name} · ${n} carte${n > 1 ? 's' : ''}`)}
        >
          <span class="dot" aria-hidden="true"></span>
          <span class="code num">{p.code}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if both}<span class="divider" aria-hidden="true"></span>{/if}

  {#if showTypes}
    <div class="group" role="group" aria-label="Filtrer par type">
      {#if both}<span class="group-label" aria-hidden="true">Types</span>{/if}
      <button class="chip all" type="button" aria-pressed={allTypes} aria-label="Tous les types" onclick={() => board.setTypeFilter([])}>
        Tous
      </button>
      <span class="sep" aria-hidden="true"></span>
      {#each board.types as t (t.id)}
        {@const on = typeFilter.includes(t.id)}
        {@const n = typeCounts.get(t.id) ?? 0}
        <button
          class="chip"
          class:dim={!allTypes && !on}
          type="button"
          aria-pressed={on}
          aria-label="{t.name} ({cartes(n)})"
          onclick={() => toggleType(t.id)}
          {@attach tooltip(`${t.name} · ${cartes(n)}`)}
        >
          <CardTypeIcon icon={t.icon} size={13} />
          <span class="type-name">{t.name}</span>
        </button>
      {/each}
      <button
        class="chip"
        class:dim={!allTypes && !noTypeOn}
        type="button"
        aria-pressed={noTypeOn}
        aria-label="Sans type ({cartes(noTypeCount)})"
        onclick={() => toggleType(NO_TYPE)}
        {@attach tooltip(`Cartes sans type · ${cartes(noTypeCount)}`)}
      >
        <span class="none-glyph" aria-hidden="true"></span>
        <span class="type-name">Sans type</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .filter-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    height: 40px;
    padding: 0 20px;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--border);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }

  .group-label {
    flex: none;
    margin-right: 4px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-subtle);
  }

  .divider {
    flex: none;
    width: 1px;
    height: 20px;
    margin: 0 10px;
    background: var(--border-strong);
  }

  .type-name {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .none-glyph {
    flex: none;
    width: 11px;
    height: 11px;
    border: 1.5px dashed var(--border-strong);
    border-radius: 3px;
  }

  .sep {
    flex: none;
    width: 1px;
    height: 16px;
    margin: 0 4px;
    background: var(--border);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-hover) ease,
      border-color var(--dur-hover) ease,
      color var(--dur-hover) ease,
      opacity var(--dur-hover) ease;
  }

  .chip:active {
    transform: scale(0.97);
  }

  .chip:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  .chip[aria-pressed='true'] {
    border-color: color-mix(in srgb, var(--c, var(--accent)) 45%, transparent);
    background: color-mix(in srgb, var(--c, var(--accent)) 12%, var(--surface));
    color: var(--text);
  }

  .chip.all[aria-pressed='true'] {
    border-color: var(--border-strong);
    background: var(--surface-3);
  }

  /* Un filtre est actif : les projets masqués s'effacent sans disparaître. */
  .chip.dim {
    opacity: 0.6;
  }

  @media (hover: hover) and (pointer: fine) {
    .chip:hover {
      color: var(--text);
      border-color: var(--border-strong);
      opacity: 1;
    }
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--c);
  }

  .code {
    letter-spacing: 0.03em;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip:active {
      transform: none;
    }
  }
</style>
