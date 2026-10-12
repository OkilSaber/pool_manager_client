<!-- Ligne planifiée : libellé collant + piste contenant la barre. Le conteneur (.row) est fourni par Timeline (animate:flip). -->
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
    onmove: (cardId: number, start: number, viaKeyboard: boolean) => void;
    onhover: (cardId: number, anchor: DOMRect, pointerX: number) => void;
    onleave: () => void;
    ondragstate: (dragging: boolean) => void;
  } = $props();
</script>

<RowLabel card={row.card} pct={row.pct} {indent} onopen={() => onopen(row.card.id)} />
<div class="track">
  <TimelineBar
    {row}
    {rangeStart}
    {rangeEnd}
    {dayWidth}
    onopen={() => onopen(row.card.id)}
    onmove={(start, viaKeyboard) => onmove(row.card.id, start, viaKeyboard)}
    onhover={(anchor, x) => onhover(row.card.id, anchor, x)}
    {onleave}
    {ondragstate}
  />
</div>

<style>
  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
  }
</style>
