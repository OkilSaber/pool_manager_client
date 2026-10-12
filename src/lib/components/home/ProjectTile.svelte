<!--
  Tuile d'un projet sans pool : ouvre le projet ; glissable vers un pool ; clic droit (ou Maj+F10) = réglages.
-->
<script lang="ts">
  import { truncatedTitle } from '$lib/components/shell/truncate';
  import type { Project } from '$lib/types/Project';
  import ProjectActions from './ProjectActions.svelte';
  import { getHomeContext, projectKeys } from './home.svelte';

  let { project }: { project: Project } = $props();

  const ctx = getHomeContext();
  const draggable = $derived(ctx.canDrag(project));
  const lifted = $derived(ctx.drag.project?.id === project.id && ctx.drag.phase !== 'idle');
</script>

<div class="wrap pm-reveal" class:archived={project.archived} class:lifted>
  <a
    class="tile"
    class:draggable
    href="/projects/{project.id}"
    draggable="false"
    data-project-link={project.id}
    aria-keyshortcuts="Shift+F10"
    {...projectKeys(ctx, project)}
  >
    <span class="top">
      <span class="dot" style:--c={project.color} aria-hidden="true"></span>
      <span class="code">{project.code}</span>
      {#if project.archived}
        <span class="pill">Archivé</span>
      {/if}
    </span>
    <span class="name" {@attach truncatedTitle}>{project.name}</span>
  </a>
  <div class="actions-slot">
    <ProjectActions {project} />
  </div>
</div>

<style>
  .wrap {
    position: relative;
    transition: transform var(--dur-press) var(--ease-out);
  }

  .wrap:has(> .tile:active) {
    transform: scale(0.98);
  }

  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 20px;
    min-height: 96px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--text);
    text-decoration: none;
    transition:
      border-color var(--dur-hover) ease,
      opacity var(--dur-exit) var(--ease-out);
  }

  .tile::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    box-shadow: var(--shadow-md);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-hover) ease;
  }

  .tile:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus);
    transition-duration: 0s;
  }

  .tile.draggable {
    cursor: grab;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Tuile saisie : reste en place, en retrait, sous le fantôme. */
  .lifted .tile {
    opacity: 0.4;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Place du « … » en haut à droite */
    padding-right: 28px;
  }

  .dot {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 999px;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  }

  .code {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    margin-left: auto;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }

  /* Archivé : en retrait, mais le nom reste lisible (opacité sur le contenu, pas sur la bordure). */
  .archived .tile {
    background: var(--surface-2);
    box-shadow: none;
  }

  .archived .top,
  .archived .name {
    opacity: 0.6;
  }

  /* Centré sur la ligne du code (1 px de bordure + 16 px + 20 / 2 = 27 px ; bouton de 26 px). */
  .actions-slot {
    position: absolute;
    top: 14px;
    right: 10px;
  }

  @media (prefers-color-scheme: dark) {
    .dot {
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14);
    }
  }

  @media (hover: hover) and (pointer: fine) {
    .tile:hover {
      border-color: var(--border-strong);
    }
    .tile:hover::after {
      opacity: 1;
    }
    .archived .tile:hover .top,
    .archived .tile:hover .name {
      opacity: 0.85;
    }
    :global(html.pm-dragging) .tile::after {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .wrap:has(> .tile:active) {
      transform: none;
    }
  }
</style>
