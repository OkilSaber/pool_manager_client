<!--
  Colonne du Kanban (= un état) : en-tête (poignée de glisser, nom, compteurs, menu),
  liste de cartes glissables, ajout rapide en pied.
  La liste locale `items` suit le store, sauf pendant un glisser où elle porte l'emplacement fantôme.
-->
<script lang="ts">
  import { dndzone, dragHandle, SHADOW_ITEM_MARKER_PROPERTY_NAME, SOURCES, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { SvelteSet } from 'svelte/reactivity';
  import { easeOutSoft, reducedMotion } from '$lib/motion';
  import { board, positionBetween } from '$lib/stores/board.svelte';
  import type { Card } from '$lib/types/Card';
  import type { State } from '$lib/types/State';
  import CardComposer from './CardComposer.svelte';
  import ColumnMenu from './ColumnMenu.svelte';
  import KanbanCard from './KanbanCard.svelte';
  import { cardDrag } from './dnd.svelte';
  import { fmtEstimate } from '$lib/format';
  import { lastInputWasKeyboard } from '$lib/modality';
  import { tooltip } from '$lib/tooltip';
  import { priority } from '$lib/priority';

  type CardItem = Card & { isDndShadowItem?: boolean };

  let { column, onopencard }: { column: State; onopencard: (cardId: number) => void } = $props();

  const FLIP = reducedMotion() ? 0 : 180;
  /** Déplacements déclenchés au clavier (glisser à l'Espace + flèches, suppression…) : jamais animés. */
  const flipMs = () => (cardDrag.keyboard || lastInputWasKeyboard() ? 0 : FLIP);

  let items = $state.raw<CardItem[]>([]);
  let body = $state<HTMLElement>();
  const fresh = new SvelteSet<number>();

  // Suit le store hors glisser (le store est optimiste : après un dépôt il a déjà le bon ordre, pas de saut).
  $effect.pre(() => {
    const next = board.cardsInState(column.id);
    if (!cardDrag.active) items = next;
  });

  const count = $derived(items.length);
  const total = $derived(items.reduce((sum, c) => sum + (c.estimate_days ?? 0), 0));

  // ---------- Glisser-déposer ----------

  function isShadow(item: CardItem): boolean {
    return !!item[SHADOW_ITEM_MARKER_PROPERTY_NAME];
  }

  function onconsider(e: CustomEvent<DndEvent<CardItem>>) {
    const { trigger, source } = e.detail.info;
    if (source === SOURCES.KEYBOARD) {
      if (trigger === TRIGGERS.DRAG_STARTED) cardDrag.keyboard = true;
      if (trigger === TRIGGERS.DRAG_STOPPED) cardDrag.keyboard = false;
    }
    cardDrag.active = trigger !== TRIGGERS.DRAG_STOPPED;
    items = e.detail.items;
  }

  function onfinalize(e: CustomEvent<DndEvent<CardItem>>) {
    const { items: next, info } = e.detail;
    items = next;
    const idx = next.findIndex((c) => String(c.id) === String(info.id));
    if (idx >= 0) persist(next, idx);
    cardDrag.active = false;
  }

  /** Enregistre la nouvelle place de la carte `list[idx]` (position flottante entre ses voisines). */
  function persist(list: CardItem[], idx: number) {
    const moved = board.card(list[idx].id);
    if (!moved) return;
    const sameState = moved.state_id === column.id;
    if (sameState) {
      const before = board.cardsInState(column.id).map((c) => c.id);
      if (before.length === list.length && before.every((id, i) => id === list[i].id)) return; // rien n'a bougé
    }
    const prev = idx > 0 ? board.card(list[idx - 1].id)?.position : undefined;
    const next = idx < list.length - 1 ? board.card(list[idx + 1].id)?.position : undefined;
    const position = positionBetween(prev, next);
    board.updateCard(moved.id, sameState ? { position } : { state_id: column.id, position });
  }

  // ---------- Ouverture d'une carte ----------

  function open(card: CardItem) {
    if (isShadow(card) || cardDrag.keyboard) return;
    onopencard(card.id);
  }

  function onkeydown(e: KeyboardEvent, card: CardItem) {
    // Entrée ouvre ; Espace est réservé au déplacement clavier (svelte-dnd-action).
    if (e.key === 'Enter' && e.target === e.currentTarget && !e.repeat) {
      e.preventDefault();
      open(card);
    }
  }

  function label(card: CardItem): string {
    return `${priority(card.priority).label} · ${card.title}`;
  }

  // ---------- Création ----------

  async function oncreated(id: number, viaPointer: boolean) {
    // Mouvement réduit : KanbanCard garde le fondu et retire le déplacement.
    if (viaPointer) {
      fresh.add(id);
      setTimeout(() => fresh.delete(id), 1000);
    }
    await tick();
    body?.scrollTo({ top: body.scrollHeight });
  }

  // ---------- Renommage ----------

  let renaming = $state(false);
  let draft = $state('');

  function startRename() {
    draft = column.name;
    renaming = true;
  }

  function commitRename() {
    if (!renaming) return;
    renaming = false;
    const name = draft.trim();
    if (name && name !== column.name) board.updateState(column.id, { name });
  }

  /** La poignée est un bouton (rôle posé par svelte-dnd-action) : Espace la déplace, Entrée renomme. */
  function onhandlekey(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.target === e.currentTarget && !e.repeat && !e.isComposing) {
      e.preventDefault();
      startRename();
    }
  }

  let handle = $state<HTMLElement>();

  /** Fin d'édition au clavier : le focus revient sur la poignée au lieu de tomber sur <body>. */
  async function refocusHandle() {
    await tick();
    handle?.focus();
  }

  function onrenamekey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      commitRename();
      refocusHandle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renaming = false;
      refocusHandle();
    }
  }
</script>

<section class="column" aria-label="Colonne {column.name}">
  <header class="head">
    {#if renaming}
      <!-- Même géométrie que la poignée : la pastille et le texte ne bougent pas d'un pixel en passant en édition. -->
      <div class="rename-wrap">
        <span class="dot" style:background={column.color} aria-hidden="true"></span>
        <input
          class="input rename"
          bind:value={draft}
          aria-label="Nom de la colonne"
          maxlength="80"
          onkeydown={onrenamekey}
          onblur={commitRename}
          {@attach (n) => { n.focus(); n.select(); }}
        />
      </div>
    {:else}
      <div
        bind:this={handle}
        class="handle"
        role="button"
        tabindex="0"
        aria-label="Déplacer la colonne {column.name} (Entrée ou double-clic pour renommer)"
        use:dragHandle
        ondblclick={startRename}
        onkeydown={onhandlekey}
      >
        <span class="dot" style:background={column.color} aria-hidden="true"></span>
        <h2 class="name" title={column.name}>{column.name}</h2>
        <span class="count num" aria-label="{count} carte{count > 1 ? 's' : ''}">{count}</span>
        {#if total > 0}
          <span class="total num" {@attach tooltip('Charge totale de la colonne')}>{fmtEstimate(total)}</span>
        {/if}
      </div>
      <ColumnMenu {column} cardCount={count} onrename={startRename} />
    {/if}
  </header>

  <div class="body" bind:this={body}>
    <div
      class="zone"
      aria-label={column.name}
      use:dndzone={{
        items,
        type: 'card',
        flipDurationMs: FLIP,
        dropTargetStyle: {},
        zoneTabIndex: -1
      }}
      {onconsider}
      {onfinalize}
    >
      {#each items as card (card.id)}
        <!-- Élément glissable géré par svelte-dnd-action (focusable, rôle listitem) : clic ou Entrée ouvre la carte. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="slot"
          class:shadow={isShadow(card)}
          role="listitem"
          aria-label={label(card)}
          animate:flip={{ duration: flipMs(), easing: easeOutSoft }}
          onclick={() => open(card)}
          onkeydown={(e) => onkeydown(e, card)}
        >
          <KanbanCard {card} fresh={fresh.has(card.id)} />
        </div>
      {/each}
    </div>
    {#if items.length === 0}
      <div class="empty" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.5 2" fill="none" />
        </svg>
        <span>Aucune carte</span>
        <span class="sub">Glissez une carte ici ou ajoutez-en une.</span>
      </div>
    {/if}
  </div>

  <footer class="foot">
    <CardComposer stateId={column.id} stateName={column.name} {oncreated} />
  </footer>
</section>

<style>
  .column {
    display: flex;
    flex-direction: column;
    width: 280px;
    height: 100%;
    min-height: 0;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
  }

  @media (prefers-color-scheme: dark) {
    .column {
      background: rgb(255 255 255 / 0.025);
    }
  }

  /* Colonne en cours de déplacement (clone svelte-dnd-action) */
  :global(#dnd-action-dragged-el) > .column {
    box-shadow: var(--shadow-lg);
    background: var(--surface-2);
  }

  @media (prefers-color-scheme: dark) {
    /* En sombre les cartes sont en --surface-2 : le clone reste un cran en dessous pour qu'elles s'en détachent. */
    :global(#dnd-action-dragged-el) > .column {
      background: var(--surface);
    }
  }

  /* ---------- En-tête ---------- */

  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 44px;
    padding: 0 6px 0 12px;
    flex: none;
  }

  .handle {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    height: 30px;
    margin-left: -6px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
  }

  .handle:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 999px;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .count {
    flex: none;
    font-size: 12px;
    color: var(--text-muted);
  }

  .total {
    flex: none;
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Calée sur .handle (-6px, pastille à 6px, texte à 28px du bord de la colonne) */
  .rename-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    margin-left: -6px;
  }

  .rename-wrap .dot {
    position: absolute;
    top: 50%;
    left: 6px;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .rename {
    height: 30px;
    padding: 0 8px 0 21px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  /* ---------- Cartes ---------- */

  .body {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 8px;
  }

  .zone {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1 0 auto;
    min-height: 72px;
    padding: 2px 0 8px;
  }

  .zone:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius);
  }

  .slot {
    position: relative;
    border-radius: var(--radius);
  }

  .slot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Emplacement fantôme : même hauteur que la carte, mais un creux discret au lieu d'un doublon. */
  .slot.shadow > :global(*) {
    visibility: hidden;
  }

  .slot.shadow::after {
    content: '';
    position: absolute;
    inset: 0;
    visibility: visible;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }

  .empty {
    position: absolute;
    top: 2px;
    left: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 88px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 12.5px;
    font-weight: 500;
    pointer-events: none;
  }

  .empty svg {
    margin-bottom: 2px;
    color: var(--text-subtle);
  }

  .empty .sub {
    font-weight: 400;
    font-size: 12px;
    color: var(--text-subtle);
  }

  /* ---------- Pied ---------- */

  .foot {
    flex: none;
    padding: 6px 8px 8px;
  }
</style>
