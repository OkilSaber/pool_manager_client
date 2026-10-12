<!-- Ligne du groupe « Non planifiées » : raison en clair et, si la carte est chiffrée, planification en un clic. -->
<script lang="ts">
  import { formatLong, isWeekend, nextWorkingDay } from '$lib/dates';
  import RowLabel from './RowLabel.svelte';
  import { LABEL_WIDTH, type UnplannedRow } from './timeline';

  let {
    item,
    todayDay,
    onopen,
    onplan
  }: {
    item: UnplannedRow;
    todayDay: number;
    onopen: (cardId: number) => void;
    onplan: (cardId: number) => Promise<unknown>;
  } = $props();

  let busy = $state(false);

  // Le week-end, « aujourd'hui » devient lundi (premier jour ouvré) : on le dit.
  // Dérivés du jour courant fourni par la chronologie (pas figés au montage de la ligne).
  const planLabel = $derived(isWeekend(todayDay) ? 'Planifier lundi' : "Planifier aujourd'hui");
  const planTitle = $derived(`Début le ${formatLong(nextWorkingDay(todayDay))}`);

  async function plan() {
    if (busy) return;
    busy = true;
    try {
      await onplan(item.card.id);
    } finally {
      busy = false;
    }
  }
</script>

<RowLabel card={item.card} indent onopen={() => onopen(item.card.id)} />
<div class="track">
  <div class="info" style:left="{LABEL_WIDTH}px">
    <span class="reason">{item.reason}</span>
    {#if item.canPlan}
      <button class="btn btn-sm" type="button" title={planTitle} disabled={busy} onclick={plan}>{planLabel}</button>
    {/if}
  </div>
</div>

<style>
  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;
  }

  /* Collée à gauche de la zone visible : la raison reste lisible quel que soit le défilement horizontal. */
  .info {
    position: sticky;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    height: 100%;
    padding-left: 12px;
    white-space: nowrap;
  }

  .reason {
    font-size: 12.5px;
    color: var(--text-muted);
  }
</style>
