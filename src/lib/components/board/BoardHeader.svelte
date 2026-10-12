<!--
  En-tête du tableau : retour, nom (renommable par le propriétaire), choix de la vue, membres.
  Le sélecteur de vue utilise une liste dupliquée « active » découpée par clip-path :
  la couleur du libellé suit exactement l'indicateur pendant qu'il glisse.
-->
<script module lang="ts">
  export type BoardView = 'kanban' | 'timeline';
  /** id du panneau de vue (rendu par la page) auquel les onglets sont reliés. */
  export const BOARD_VIEW_PANEL_ID = 'board-view-panel';
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { board } from '$lib/stores/board.svelte';
  import MembersDialog from './MembersDialog.svelte';
  import { lastInputWasKeyboard } from '$lib/modality';
  import { tooltip } from '$lib/tooltip';

  let { view, onviewchange }: { view: BoardView; onviewchange: (view: BoardView) => void } = $props();

  const VIEWS: { value: BoardView; label: string }[] = [
    { value: 'kanban', label: 'Tableau' },
    { value: 'timeline', label: 'Chronologie' }
  ];

  const MAX_AVATARS = 4;

  const index = $derived(Math.max(0, VIEWS.findIndex((v) => v.value === view)));
  const members = $derived(board.members);
  const overflow = $derived(Math.max(0, members.length - MAX_AVATARS));

  let membersOpen = $state(false);

  // ---------- Sélecteur de vue ----------

  let instant = $state(false);
  let tabs: HTMLButtonElement[] = $state([]);

  function select(v: BoardView) {
    // Changement au clavier : pas d'animation.
    instant = lastInputWasKeyboard();
    if (v !== view) onviewchange(v);
  }

  function ontabkey(e: KeyboardEvent) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % VIEWS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = VIEWS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    instant = true;
    onviewchange(VIEWS[next].value);
    tabs[next]?.focus();
  }

  // ---------- Renommage ----------

  let editing = $state(false);
  let draft = $state('');
  let pendingName = $state<string | null>(null);

  const name = $derived(pendingName ?? board.detail?.board.name ?? '');

  function startEdit() {
    if (!board.isOwner) return;
    draft = name;
    editing = true;
  }

  async function commit() {
    if (!editing) return;
    editing = false;
    const value = draft.trim();
    if (!value || value === board.detail?.board.name) return;
    pendingName = value; // affiché tout de suite, sans attendre le serveur
    await board.rename(value);
    pendingName = null;
  }

  let nameBtn = $state<HTMLButtonElement>();

  /** Fin d'édition au clavier : le focus revient sur le nom au lieu de tomber sur <body>. */
  async function refocusName() {
    await tick();
    nameBtn?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      commit();
      refocusName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing = false;
      refocusName();
    }
  }
</script>

<header class="board-header">
  <div class="left">
    <a class="btn btn-ghost btn-sm btn-icon back" href="/boards" aria-label="Retour aux tableaux" {@attach tooltip('Tous les tableaux')}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </a>

    {#if editing}
      <input
        class="input name-input"
        bind:value={draft}
        aria-label="Nom du tableau"
        maxlength="120"
        {onkeydown}
        onblur={commit}
        {@attach (n) => { n.focus(); n.select(); }}
      />
    {:else if board.isOwner}
      <h1 class="name-wrap">
        <button bind:this={nameBtn} class="name-btn" type="button" onclick={startEdit} aria-label="{name} — renommer le tableau" {@attach tooltip('Renommer')}>
          {name}
        </button>
      </h1>
    {:else}
      <h1 class="name" title={name}>{name}</h1>
    {/if}

    <div class="seg" class:instant role="tablist" aria-label="Vue du tableau" style:--i={index} style:--n={VIEWS.length}>
      <span class="thumb" aria-hidden="true"></span>
      {#each VIEWS as v, i (v.value)}
        <button
          bind:this={tabs[i]}
          class="seg-btn"
          type="button"
          role="tab"
          aria-selected={view === v.value}
          aria-controls={BOARD_VIEW_PANEL_ID}
          tabindex={view === v.value ? 0 : -1}
          onclick={() => select(v.value)}
          onkeydown={ontabkey}
        >
          {v.label}
        </button>
      {/each}
      <div class="seg-active" aria-hidden="true">
        {#each VIEWS as v (v.value)}
          <span>{v.label}</span>
        {/each}
      </div>
    </div>
  </div>

  <button class="btn btn-sm members" type="button" onclick={() => (membersOpen = true)} aria-label="Membres du tableau ({members.length})">
    <span class="stack" aria-hidden="true">
      {#each members.slice(0, MAX_AVATARS) as m (m.user_id)}
        <Avatar id={m.user_id} name={m.display_name} size={20} ring />
      {/each}
      {#if overflow}
        <span class="more num">+{overflow}</span>
      {/if}
    </span>
    Membres
  </button>
</header>

<MembersDialog bind:open={membersOpen} />

<style>
  .board-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    /* Même hauteur et mêmes retraits que la barre d'application au-dessus (48 px, 12 px). */
    height: 48px;
    flex: none;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .back {
    flex: none;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .name-wrap {
    min-width: 0;
    max-width: 420px;
  }

  .name {
    min-width: 0;
    max-width: 420px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .name-btn {
    display: block;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    height: 30px;
    padding: 0 8px;
    margin-left: -4px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: text;
    transition: border-color var(--dur-hover) ease;
  }

  .name-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  @media (hover: hover) and (pointer: fine) {
    .name-btn:hover {
      border-color: var(--border);
    }
  }

  .name-input {
    width: 320px;
    height: 30px;
    margin-left: -4px;
    padding: 0 8px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em; /* comme le h1 : le texte ne « respire » pas différemment en édition */
  }

  /* ---------- Sélecteur de vue ---------- */

  .seg {
    position: relative;
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    flex: none;
    margin-left: 8px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--surface-3);
  }

  .seg-btn,
  .seg-active span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: normal;
    white-space: nowrap;
  }

  .seg-btn {
    position: relative;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    cursor: pointer;
    transition: color var(--dur-hover) ease;
  }

  .seg-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  @media (hover: hover) and (pointer: fine) {
    .seg-btn:hover {
      color: var(--text);
    }
  }

  .thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc((100% - 4px) / var(--n));
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    transform: translateX(calc(var(--i) * 100%));
    transition: transform 200ms var(--ease-out);
  }

  /* Copie « active » des libellés, découpée sur l'onglet courant. */
  .seg-active {
    position: absolute;
    inset: 2px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    color: var(--text);
    pointer-events: none;
    clip-path: inset(0 calc((var(--n) - 1 - var(--i)) * 100% / var(--n)) 0 calc(var(--i) * 100% / var(--n)) round 6px);
    transition: clip-path 200ms var(--ease-out);
  }

  .seg.instant .thumb,
  .seg.instant .seg-active {
    transition: none;
  }

  @media (prefers-color-scheme: dark) {
    .seg {
      background: var(--surface-2);
    }
    .thumb {
      background: var(--surface-3);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .thumb,
    .seg-active {
      transition: none;
    }
  }

  /* ---------- Membres ---------- */

  .members {
    flex: none;
    gap: 8px;
    padding-left: 4px;
  }

  .stack {
    display: inline-flex;
    align-items: center;
  }

  .stack > :global(* + *) {
    margin-left: -5px;
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
</style>
