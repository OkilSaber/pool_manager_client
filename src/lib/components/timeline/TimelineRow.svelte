<!-- Ligne planifiée : libellé collant + piste contenant la barre (ou une part par assigné). Le conteneur (.row) est fourni par Timeline (animate:flip). -->
<script lang="ts">
  import RowLabel from './RowLabel.svelte';
  import TimelineBar from './TimelineBar.svelte';
  import type { TimelineRow } from './timeline';

  let {
    row,
    indent,
    rangeStart,
    rangeEnd,
    dayWidth,
    onopen,
    onmove,
    onhover,
    onleave,
    ondragstate
  }: {
    row: TimelineRow;
    indent: boolean;
    rangeStart: number;
    rangeEnd: number;
    dayWidth: number;
    onopen: (cardId: number) => void;
    /** `userId` : assigné dont la date change (part d'une carte à plusieurs personnes) ; null = date de la carte */
    onmove: (cardId: number, userId: number | null, start: number, viaKeyboard: boolean) => void;
    onhover: (cardId: number, userId: number | null, anchor: DOMRect, pointerX: number) => void;
    onleave: () => void;
    ondragstate: (dragging: boolean) => void;
  } = $props();
</script>

<RowLabel card={row.card} pct={row.pct} {indent} onopen={() => onopen(row.card.id)} />
<div class="track">
  {#each row.segments as segment (segment.key)}
    <TimelineBar
      {row}
      {segment}
      {rangeStart}
      {rangeEnd}
      {dayWidth}
      onopen={() => onopen(row.card.id)}
      onmove={(start, viaKeyboard) => onmove(row.card.id, segment.userId, start, viaKeyboard)}
      onhover={(anchor, x) => onhover(row.card.id, segment.userId, anchor, x)}
      {onleave}
      {ondragstate}
    />
  {/each}
</div>

<style>
  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
  }
</style>
