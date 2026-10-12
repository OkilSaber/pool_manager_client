<!--
  Fond de la grille, derrière les lignes : traits de jours / semaines (dégradés en tuiles, aucun nœud par jour),
  week-ends ombrés, traits de début de mois et ligne « aujourd'hui ».
-->
<script lang="ts">
  import { dayX, LABEL_WIDTH, monthStarts, type Range, type Zoom } from './timeline';

  let { range, zoom, dayWidth, todayDay }: { range: Range; zoom: Zoom; dayWidth: number; todayDay: number } = $props();

  const width = $derived(range.days * dayWidth);
  const months = $derived(monthStarts(range));
  const todayIn = $derived(todayDay >= range.start && todayDay <= range.end);
  const todayX = $derived(Math.round(dayX(todayDay, range.start, dayWidth) + dayWidth / 2));

  // La plage commence un lundi : les jours 5 et 6 de chaque tuile de 7 jours sont le week-end.
  const background = $derived.by(() => {
    const week = 7 * dayWidth;
    const weekend = `linear-gradient(to right, transparent ${5 * dayWidth}px, var(--weekend) ${5 * dayWidth}px) 0 0 / ${week}px 100%`;
    if (zoom === 'day') return `linear-gradient(to right, var(--tl-line) 1px, transparent 1px) 0 0 / ${dayWidth}px 100%, ${weekend}`;
    if (zoom === 'week') return `linear-gradient(to right, var(--tl-line) 1px, transparent 1px) 0 0 / ${week}px 100%, ${weekend}`;
    return `linear-gradient(to right, var(--tl-line-faint) 1px, transparent 1px) 0 0 / ${week}px 100%`;
  });
</script>

<div class="grid" style:left="{LABEL_WIDTH}px" style:width="{width}px" style:background aria-hidden="true">
  {#each months as m (m)}
    <span class="month" style:left="{dayX(m, range.start, dayWidth)}px"></span>
  {/each}
  {#if todayIn}
    <span class="today" style:left="{todayX - 1}px"></span>
  {/if}
</div>

<style>
  .grid {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 0;
    pointer-events: none;
  }
  .month {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--border);
  }
  .today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    opacity: 0.85;
  }
</style>
