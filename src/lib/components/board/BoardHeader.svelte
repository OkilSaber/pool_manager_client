<!--
  En-tête du tableau ouvert.
  - Pool : nom (renommable par son propriétaire), « Projets », membres du pool.
  - Projet : fil « Pool › » s'il est rattaché, pastille de couleur, nom (renommable), code, réglages ;
    membres du pool s'il en a un (aucun pour un projet autonome).
  - « Colonnes » : éditeur des états (pool ou projet autonome ; lecture seule avec lien vers le pool
    pour un projet rattaché, dont les colonnes sont celles du pool).
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
  import ProjectFormDialog from '$lib/components/projects/ProjectFormDialog.svelte';
  import ProjectsDialog from '$lib/components/projects/ProjectsDialog.svelte';
  import { board } from '$lib/stores/board.svelte';
  import MembersDialog from './MembersDialog.svelte';
  import StatesEditor from './StatesEditor.svelte';
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
  const isPool = $derived(board.kind === 'pool');
  const project = $derived(board.project);
  /** Pool du projet ouvert (vue projet rattachée à un pool). */
  const parentPool = $derived(!isPool ? board.pool : null);
  /** Pool : son propriétaire renomme. Projet : toute personne y ayant accès (comme le serveur). */
  const canRename = $derived(isPool ? board.isOwner : project != null);
  const activeCount = $derived(board.activeProjects.length);

  let membersOpen = $state(false);
  let projectsOpen = $state(false);
  let settingsOpen = $state(false);
  let statesOpen = $state(false);
  /** Projet rattaché : ses colonnes sont celles du pool (éditeur en lecture seule). */
  const statesManaged = $derived(!isPool && parentPool != null);

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

  const name = $derived(pendingName ?? board.title);
  const what = $derived(isPool ? 'le pool' : 'le projet');

  function startEdit() {
    if (!canRename) return;
    draft = name;
    editing = true;
  }

  async function commit() {
    if (!editing) return;
    editing = false;
    const value = draft.trim();
    if (!value || value === board.title) return;
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
    <a
      class="btn btn-ghost btn-sm btn-icon back"
      href={parentPool ? `/pools/${parentPool.id}` : '/pools'}
      aria-label={parentPool ? `Retour au pool ${parentPool.name}` : 'Retour aux pools'}
      {@attach tooltip(parentPool ? 'Retour au pool' : 'Tous les pools')}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </a>

    {#if parentPool}
      <nav class="crumb" aria-label="Fil d’Ariane">
        <a class="crumb-link" href="/pools/{parentPool.id}" title={parentPool.name}>{parentPool.name}</a>
        <svg class="crumb-sep" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </nav>
    {/if}

    {#if project}
      <span class="project-dot" style:background={project.color} aria-hidden="true"></span>
    {/if}

    {#if editing}
      <input
        class="input name-input"
        bind:value={draft}
        aria-label={isPool ? 'Nom du pool' : 'Nom du projet'}
        maxlength="120"
        {onkeydown}
        onblur={commit}
        {@attach (n) => { n.focus(); n.select(); }}
      />
    {:else if canRename}
      <h1 class="title">
        <button bind:this={nameBtn} class="name-btn" type="button" onclick={startEdit} aria-label="{name} — renommer {what}" {@attach tooltip('Renommer')}>
          {name}
        </button>
      </h1>
    {:else}
      <h1 class="title"><span class="name" title={name}>{name}</span></h1>
    {/if}

    {#if project}
      <span class="code num" aria-label="Code {project.code}">{project.code}</span>
      {#if project.archived}
        <span class="archived">Archivé</span>
      {/if}
      <button
        class="btn btn-ghost btn-sm btn-icon settings"
        type="button"
        aria-label="Réglages du projet"
        onclick={() => (settingsOpen = true)}
        {@attach tooltip('Réglages du projet')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <circle cx="11" cy="4.5" r="1.5" stroke="currentColor" stroke-width="1.4" fill="none" />
          <circle cx="5" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.4" fill="none" />
        </svg>
      </button>
    {/if}

    <div class="seg" class:instant role="tablist" aria-label="Vue" style:--i={index} style:--n={VIEWS.length}>
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

  <div class="right">
    {#if board.kind}
      <button
        class="btn btn-sm"
        type="button"
        onclick={() => (statesOpen = true)}
        aria-label={statesManaged ? 'Colonnes (gérées par le pool)' : `Colonnes (${board.states.length})`}
        {@attach tooltip(statesManaged ? 'Colonnes gérées par le pool' : isPool ? 'Colonnes du pool' : 'Colonnes du projet')}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="3.4" height="11" rx="1" stroke="currentColor" stroke-width="1.3" fill="none" />
          <rect x="6.3" y="2.5" width="3.4" height="7.5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none" />
          <rect x="10.6" y="2.5" width="3.4" height="9.5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none" />
        </svg>
        Colonnes
        {#if !statesManaged}
          <span class="badge num" aria-hidden="true">{board.states.length}</span>
        {/if}
      </button>
    {/if}

    {#if isPool}
      <button class="btn btn-sm" type="button" onclick={() => (projectsOpen = true)} aria-label="Projets du pool ({activeCount})">
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3" fill="none" />
          <rect x="9" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3" fill="none" />
          <rect x="2" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.3" fill="none" />
          <path d="M11.5 9.5v5M9 12h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        Projets
        <span class="badge num" aria-hidden="true">{activeCount}</span>
      </button>
    {/if}

    {#if board.pool}
      <button class="btn btn-sm members" type="button" onclick={() => (membersOpen = true)} aria-label="Membres du pool ({members.length})">
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
    {/if}
  </div>
</header>

{#if board.pool}
  <MembersDialog bind:open={membersOpen} />
{/if}
{#if isPool}
  <ProjectsDialog bind:open={projectsOpen} />
{/if}
{#if board.kind}
  <StatesEditor bind:open={statesOpen} />
{/if}
{#if project}
  <ProjectFormDialog bind:open={settingsOpen} {project} />
{/if}

<style>
  .board-header {
    display: flex;
    align-items: center;
    gap: 16px;
    /* Même hauteur et mêmes retraits que la barre d'application au-dessus (48 px, 12 px). */
    height: 48px;
    flex: none;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  /* La partie gauche prend toute la place libre ; le nom n'est tronqué que s'il n'y tient plus. */
  .left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .back {
    flex: none;
  }

  /* ---------- Fil d'Ariane, nom, code ---------- */

  .crumb {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 3 auto;
    min-width: 48px;
  }

  .crumb-link {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-radius: 4px;
    transition: color var(--dur-hover) ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .crumb-link:hover {
      color: var(--text);
    }
  }

  .crumb-sep {
    flex: none;
    color: var(--text-subtle);
  }

  .project-dot {
    flex: none;
    width: 10px;
    height: 10px;
    margin-left: 2px;
    border-radius: 999px;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .title {
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .name-btn {
    flex: 0 1 auto;
    min-width: 0;
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

  .project-dot + .title .name-btn {
    margin-left: -6px;
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
    flex: 0 1 320px;
    min-width: 120px;
    height: 30px;
    margin-left: -4px;
    padding: 0 8px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em; /* comme le h1 : le texte ne « respire » pas différemment en édition */
  }

  .code {
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .archived {
    flex: none;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .settings {
    flex: none;
  }

  .badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--surface-3);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    color: var(--text-muted);
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
