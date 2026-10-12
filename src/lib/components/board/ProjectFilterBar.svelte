<!--
  Filtre par projet d'un pool (Kanban et Chronologie) : une pastille par projet actif, sélection multiple ;
  « Tous » efface le filtre. Mémorisé par pool (store). Boutons bascule (aria-pressed) : Tab / Entrée / Espace.
-->
<script lang="ts">
  import { board } from '$lib/stores/board.svelte';
  import { tooltip } from '$lib/tooltip';

  const filter = $derived(board.projectFilter);
  const all = $derived(filter.length === 0);

  const counts = $derived.by(() => {
    const m = new Map<number, number>();
    for (const c of board.cards) m.set(c.project_id, (m.get(c.project_id) ?? 0) + 1);
    return m;
  });

  function toggle(id: number) {
    const next = filter.includes(id) ? filter.filter((p) => p !== id) : [...filter, id];
    // Tous les projets cochés un à un : équivaut à « Tous ».
    board.setProjectFilter(next.length === board.activeProjects.length ? [] : next);
  }
</script>

<div class="filter-bar" role="group" aria-label="Filtrer par projet">
  <button class="chip all" type="button" aria-pressed={all} onclick={() => board.setProjectFilter([])}>Tous</button>
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
