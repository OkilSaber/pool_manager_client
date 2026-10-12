<!--
  Vue Kanban : rangée de colonnes défilant horizontalement.
  Les colonnes se réordonnent en les tirant par leur en-tête (poignée), les cartes se glissent
  entre et dans les colonnes. Tout est optimiste : le store bouge au dépôt, le serveur confirme ensuite.
-->
<script lang="ts">
  import { dragHandleZone, SHADOW_ITEM_MARKER_PROPERTY_NAME, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { easeOutSoft, reducedMotion } from '$lib/motion';
  import { board, positionBetween } from '$lib/stores/board.svelte';
  import type { State } from '$lib/types/State';
  import AddColumn from './AddColumn.svelte';
  import KanbanColumn from './KanbanColumn.svelte';
  import { cardDrag, configureDnd, markDropping } from './dnd.svelte';
  import { lastInputWasKeyboard } from '$lib/modality';

  type ColumnItem = State & { isDndShadowItem?: boolean };

  let {
    onopencard,
    oncreatecard
  }: {
    onopencard: (cardId: number) => void;
    /** Ouvre la modale de carte en création dans la colonne `stateId`. */
    oncreatecard: (stateId: number) => void;
  } = $props();

  configureDnd();

  // État de glisser partagé (module) : un glisser interrompu par un démontage (changement de vue, navigation
  // pendant un glisser au clavier) ne doit pas figer les colonnes vides au prochain affichage du Kanban.
  $effect(() => () => {
    cardDrag.active = false;
    cardDrag.keyboard = false;
  });

  const FLIP = reducedMotion() ? 0 : 200;
  /** Réordonnancement déclenché au clavier (Espace + flèches, suppression depuis le menu) : instantané. */
  const flipMs = () => (lastInputWasKeyboard() ? 0 : FLIP);

  let columns = $state.raw<ColumnItem[]>([]);
  let dragging = $state(false);

  $effect.pre(() => {
    const next = board.states;
    if (!dragging) columns = next;
  });

  function isShadow(c: ColumnItem): boolean {
    return !!c[SHADOW_ITEM_MARKER_PROPERTY_NAME];
  }

  function onconsider(e: CustomEvent<DndEvent<ColumnItem>>) {
    dragging = e.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    columns = e.detail.items;
  }

  function onfinalize(e: CustomEvent<DndEvent<ColumnItem>>) {
    const { items, info } = e.detail;
    columns = items;
    const idx = items.findIndex((c) => String(c.id) === String(info.id));
    if (idx >= 0) {
      const before = board.states.map((s) => s.id);
      const changed = before.length !== items.length || before.some((id, i) => id !== items[i].id);
      if (changed) {
        const prev = idx > 0 ? items[idx - 1].position : undefined;
        const next = idx < items.length - 1 ? items[idx + 1].position : undefined;
        board.updateState(items[idx].id, { position: positionBetween(prev, next) });
      }
    }
    dragging = false;
  }
</script>

<svelte:window onmouseup={markDropping} ontouchend={markDropping} />

<div class="kanban">
  <div class="track">
    <div
      class="columns"
      aria-label="Colonnes"
      use:dragHandleZone={{
        items: columns,
        type: 'column',
        flipDurationMs: FLIP,
        dropTargetStyle: {},
        zoneTabIndex: -1
      }}
      {onconsider}
      {onfinalize}
    >
      {#each columns as column (column.id)}
        <div class="col-slot" class:shadow={isShadow(column)} aria-label={column.name} animate:flip={{ duration: flipMs(), easing: easeOutSoft }}>
          {#if isShadow(column)}
            <div class="col-placeholder"></div>
          {:else}
            <KanbanColumn {column} {onopencard} {oncreatecard} />
          {/if}
        </div>
      {/each}
    </div>
    <AddColumn />
  </div>
</div>

<style>
  .kanban {
    flex: 1;
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .track {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: max-content;
    height: 100%;
    padding: 16px 20px;
  }

  .columns {
    display: flex;
    gap: 12px;
    height: 100%;
  }

  .col-slot {
    height: 100%;
    border-radius: var(--radius-lg);
  }

  .col-placeholder {
    width: 280px;
    height: 100%;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
  }

  /* svelte-dnd-action masque l'emplacement fantôme ; on garde visible notre creux en pointillés. */
  .col-slot.shadow > .col-placeholder {
    visibility: visible;
  }

  /*
   * Élément glissé (carte ou colonne) : la bibliothèque anime le dépôt et le morphing en `ease` (trop mou,
   * démarre lentement au moment où l'œil suit). On impose la courbe ease-out forte du design system :
   * la carte « se pose » tout de suite. Pendant le glisser, le déplacement reste un transform non animé.
   */
  :global(#dnd-action-dragged-el) {
    transition-timing-function: var(--ease-out) !important;
  }
</style>
