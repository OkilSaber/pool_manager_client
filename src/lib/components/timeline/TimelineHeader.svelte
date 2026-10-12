<!--
  En-tête collant (sticky top) sur deux lignes : mois, puis jours / semaines selon le zoom.
  Le coin gauche est collant dans les deux sens ; le nom du mois reste lisible en défilant (sticky left).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { formatLong } from '$lib/dates';
  import { dayX, HEADER_ROW1, HEADER_ROW2, LABEL_WIDTH, monthSegments, ticks, type Range, type Zoom } from './timeline';

  let {
    range,
    zoom,
    dayWidth,
    todayDay,
    corner
  }: { range: Range; zoom: Zoom; dayWidth: number; todayDay: number; corner: Snippet } = $props();

  const months = $derived(monthSegments(range, dayWidth));
  const cells = $derived(ticks(range, zoom, dayWidth, todayDay));
  const todayIn = $derived(todayDay >= range.start && todayDay <= range.end);
  const todayX = $derived(dayX(todayDay, range.start, dayWidth) + dayWidth / 2);
</script>

<div class="head" style:--label-w="{LABEL_WIDTH}px">
  <div class="corner" style:width="{LABEL_WIDTH}px">
    <!-- Centré dans la rangée des jours : même ligne de lecture que les dates. -->
    <div class="corner-row" style:height="{HEADER_ROW2}px">{@render corner()}</div>
  </div>
  <div class="cols" style:width="{range.days * dayWidth}px">
    <div class="months" style:height="{HEADER_ROW1}px">
      {#each months as m (m.key)}
        <div class="month" style:width="{m.width}px">
          {#if m.label}<span class="month-label">{m.label}</span>{/if}
        </div>
      {/each}
    </div>
    <div class="ticks" class:days={zoom === 'day'} class:compact={zoom === 'month'} style:height="{HEADER_ROW2}px">
      {#each cells as t (t.key)}
        <div class="tick" class:weekend={t.weekend} style:width="{t.width}px" title={t.today ? `Aujourd'hui · ${t.title}` : t.title}>
          {#if zoom === 'day'}
            <span class="day" class:today={t.today}><span class="sub">{t.sub}</span><span class="num">{t.main}</span></span>
          {:else if !t.today}
            <!-- La semaine en cours cède sa place à la pastille « Aujourd'hui » (rien de rogné dessous). -->
            {#if t.sub}<span class="sub num">{t.sub}</span>{/if}<span class="num">{t.main}</span>
          {/if}
        </div>
      {/each}
      {#if todayIn && zoom !== 'day'}
        <span class="today-pill" style:left="{todayX}px" title={formatLong(todayDay)}>Aujourd'hui</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .head {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex: none;
    background: var(--surface);
    box-shadow: inset 0 -1px 0 var(--border);
  }

  .corner {
    position: sticky;
    left: 0;
    z-index: 1;
    flex: none;
    display: flex;
    align-items: flex-end;
    padding: 0 12px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    box-shadow: inset 0 -1px 0 var(--border);
  }

  .corner-row {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .cols {
    flex: none;
  }

  .months,
  .ticks {
    display: flex;
  }

  .month {
    flex: none;
    display: flex;
    align-items: center;
    overflow: clip;
    box-shadow: inset 1px 0 0 var(--border);
  }

  /* Le nom du mois suit le défilement tant que son mois est visible. */
  .month-label {
    position: sticky;
    left: calc(var(--label-w) + 2px);
    padding: 0 8px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    text-transform: capitalize;
    color: var(--text);
  }

  .ticks {
    position: relative;
    box-shadow: inset 0 1px 0 var(--tl-line);
  }

  .tick {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    overflow: clip;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--text-muted);
    box-shadow: inset 1px 0 0 var(--tl-line);
  }

  /* Au zoom « Mois », ces numéros sont le seul repère de date : gris secondaire, pas tertiaire. */
  .compact .tick {
    padding: 0 4px;
    font-size: 11px;
  }

  .days .tick {
    justify-content: center;
    padding: 0;
  }

  .tick.weekend {
    background: var(--weekend);
    color: var(--text-subtle);
  }

  .sub {
    font-size: 10.5px;
    color: var(--text-subtle);
  }

  .day {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    padding: 2px 5px;
    border-radius: 5px;
  }

  .day.today {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .day.today .sub {
    color: inherit;
    opacity: 0.8;
  }

  .today-pill {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 10.5px;
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
    box-shadow: 0 0 0 2px var(--surface);
  }
</style>
