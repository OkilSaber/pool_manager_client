<!--
  Tuile d'un pool sur l'accueil : ouvre le pool, se déplie pour lister ses projets, et sert de zone de dépôt
  (y lâcher un projet l'y rattache, que la tuile soit dépliée ou non).
  Le lien couvre toute la tuile (pseudo-élément) ; les lignes de projet et les boutons passent au-dessus.
-->
<script lang="ts">
  import { slide, fade } from 'svelte/transition';
  import { hue } from '$lib/avatar';
  import DropdownMenu from '$lib/components/shell/DropdownMenu.svelte';
  import MenuItem from '$lib/components/shell/MenuItem.svelte';
  import { truncatedTitle } from '$lib/components/shell/truncate';
  import { lastInputWasKeyboard } from '$lib/modality';
  import { DUR, easeOut, easeOutSoft, reducedMotion } from '$lib/motion';
  import type { Pool } from '$lib/types/Pool';
  import type { Project } from '$lib/types/Project';
  import ProjectActions from './ProjectActions.svelte';
  import ProjectChip from './ProjectChip.svelte';
  import { dropAttr, getHomeContext, projectKeys } from './home.svelte';

  let {
    pool,
    projects,
    expanded,
    ontoggle,
    ondelete
  }: {
    pool: Pool;
    /** Projets de ce pool (actifs puis archivés). */
    projects: Project[];
    expanded: boolean;
    ontoggle: () => void;
    ondelete: (pool: Pool) => void;
  } = $props();

  const ctx = getHomeContext();
  const uid = $props.id();
  const still = reducedMotion();
  const menuKey = $derived(`pool:${pool.id}`);
  const dropState = $derived(ctx.drag.stateOf(pool.id));
  /** Dépliage demandé au clavier : le chevron tourne sans transition. */
  let instant = $state(false);

  function initial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  function projectCount(n: number): string {
    if (n === 0) return 'Aucun projet';
    return `${n} projet${n > 1 ? 's' : ''}`;
  }

  /** Dépliage : hauteur animée à la souris, instantané au clavier, fondu seul en mouvement réduit. */
  function reveal(node: Element, { out }: { out: boolean }) {
    const duration = lastInputWasKeyboard() ? 0 : out ? DUR.exit : 200;
    const easing = out ? easeOutSoft : easeOut;
    return still ? fade(node, { duration, easing }) : slide(node, { duration, easing });
  }
</script>

<div class="card" class:expanded data-drop={dropAttr(pool.id)} data-drop-state={dropState}>
  <a class="link" href="/pools/{pool.id}" draggable="false">
    <span class="mark" style:--h={hue(pool.id)} aria-hidden="true">{initial(pool.name)}</span>
    <span class="body">
      <span class="name" {@attach truncatedTitle}>{pool.name}</span>
      <span class="meta">
        <span class="pill" class:owner={pool.role === 'owner'}>
          {pool.role === 'owner' ? 'Propriétaire' : 'Membre'}
        </span>
        <span class="meta-text num">{projectCount(pool.project_count)}</span>
      </span>
    </span>
  </a>

  {#if projects.length > 0}
    <button
      class="toggle"
      type="button"
      aria-expanded={expanded}
      aria-controls="{uid}-list"
      data-instant={instant || undefined}
      onclick={(e) => {
        instant = e.detail === 0;
        ontoggle();
      }}
    >
      <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.5 2.75 7.75 6 4.5 9.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {expanded ? 'Masquer les projets' : `Afficher les projets (${projects.length})`}
    </button>
  {/if}

  {#if expanded && projects.length > 0}
    <div class="list-clip" in:reveal={{ out: false }} out:reveal={{ out: true }}>
      <ul class="list" id="{uid}-list" aria-label="Projets du pool {pool.name}">
        {#each projects as project (project.id)}
          {@const draggable = ctx.canDrag(project)}
          <li
            class="row-wrap pm-reveal"
            class:lifted={ctx.drag.project?.id === project.id && ctx.drag.phase !== 'idle'}
          >
            <a
              class="row"
              class:draggable
              href="/projects/{project.id}"
              draggable="false"
              data-project-link={project.id}
              aria-keyshortcuts="Shift+F10"
              {...projectKeys(ctx, project)}
            >
              <ProjectChip {project} archivedPill />
            </a>
            <ProjectActions {project} size="sm" />
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if pool.role === 'owner'}
    <div class="pool-actions" class:visible={ctx.menuFor() === menuKey}>
      <DropdownMenu
        label="Actions du pool {pool.name}"
        align="end"
        width={176}
        bind:open={
          () => ctx.menuFor() === menuKey,
          (v) => {
            if (v) ctx.setMenu(menuKey);
            else if (ctx.menuFor() === menuKey) ctx.setMenu(null);
          }
        }
      >
        {#snippet trigger(props)}
          <button {...props} class="btn btn-ghost btn-sm btn-icon more" aria-label="Actions du pool {pool.name}">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
              <circle cx="8" cy="8" r="1.25" fill="currentColor" />
              <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
            </svg>
          </button>
        {/snippet}
        <MenuItem danger onselect={() => ondelete(pool)}>
          {#snippet icon()}
            <svg width="14" height="14" viewBox="0 0 16 16">
              <path
                d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4 4.25l.6 8.4a1.25 1.25 0 0 0 1.25 1.1h4.3a1.25 1.25 0 0 0 1.25-1.1l.6-8.4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {/snippet}
          Supprimer…
        </MenuItem>
      </DropdownMenu>
    </div>
  {/if}
</div>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 148px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--text);
    transition:
      border-color var(--dur-hover) ease,
      background-color var(--dur-hover) ease,
      transform var(--dur-press) var(--ease-out);
  }

  /* Ombre de survol : opacité d'un pseudo-élément (composité) plutôt qu'un box-shadow animé. */
  .card::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    box-shadow: var(--shadow-md);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-hover) ease;
  }

  /* Pression sur le lien : toute la tuile réagit. */
  .card:has(> .link:active) {
    transform: scale(0.98);
  }

  .card:has(> .link:focus-visible) {
    border-color: var(--accent);
    box-shadow: var(--focus);
    transition-duration: 0s;
  }

  .link {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 20px;
    padding: 16px;
    color: inherit;
    text-decoration: none;
    outline: none;
  }

  /* Lien étiré : toute la surface de la tuile ouvre le pool. */
  .link::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }

  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 650;
    color: hsl(var(--h) 50% 34%);
    background: hsl(var(--h) 70% 92%);
  }

  .body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
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

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .meta-text {
    color: var(--text-muted);
    font-size: 12px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
  }

  .pill.owner {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* ---------- Dépliage ---------- */

  .toggle {
    position: relative; /* au-dessus du lien étiré */
    z-index: 1;
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    height: 26px;
    margin: -8px 10px 10px;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color var(--dur-hover) ease,
      color var(--dur-hover) ease;
  }

  .toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  .chevron {
    transition: transform 180ms var(--ease-out);
  }

  .expanded .chevron {
    transform: rotate(90deg);
  }

  .toggle[data-instant] .chevron {
    transition: none;
  }

  /* Pas d'overflow: hidden ici (slide le pose pendant l'animation seulement) : le menu « … » d'une ligne déborde. */
  .list-clip {
    position: relative;
    z-index: 1;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0 6px 8px;
    list-style: none;
    border-top: 1px solid var(--border);
    padding-top: 6px;
    /* Les vides entre lignes laissent passer le clic vers le lien du pool. */
    pointer-events: none;
  }

  .row-wrap {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    pointer-events: auto;
  }

  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 30px 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
    text-decoration: none;
    transition: background-color var(--dur-hover) ease;
  }

  .row :global(.chip) {
    flex: 1;
  }

  .row:focus-visible {
    outline: none;
    box-shadow: var(--focus);
    transition-duration: 0s;
  }

  .row:active {
    background: var(--surface-3);
  }

  .row.draggable {
    cursor: grab;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Ligne saisie : reste en place, en retrait, sous le fantôme. */
  .row-wrap.lifted .row {
    opacity: 0.4;
  }

  .row-wrap :global(.actions) {
    position: absolute;
    right: 4px;
  }

  .pool-actions {
    position: absolute;
    top: 18px;
    right: 10px;
    z-index: 2;
  }

  .pool-actions.visible .more {
    background: var(--surface-3);
    color: var(--text);
  }

  /* ---------- Cible de dépôt ---------- */

  .card[data-drop-state='can'] {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .card[data-drop-state='over'] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent-soft) 70%, var(--surface));
    box-shadow: var(--focus);
  }

  @media (prefers-color-scheme: dark) {
    .mark {
      color: hsl(var(--h) 70% 84%);
      background: hsl(var(--h) 32% 25%);
    }
    .pill.owner {
      color: color-mix(in srgb, var(--accent) 65%, white);
    }
  }

  @media (hover: hover) and (pointer: fine) {
    .card:hover {
      border-color: var(--border-strong);
    }
    .card:hover::after {
      opacity: 1;
    }
    .card[data-drop-state='over']:hover {
      border-color: var(--accent);
    }
    .toggle:hover {
      background: var(--surface-2);
      color: var(--text);
    }
    .row:hover {
      background: var(--surface-2);
    }
    .more {
      opacity: 0;
    }
    .card:hover .pool-actions .more {
      opacity: 1;
      transition:
        opacity 120ms ease,
        transform var(--dur-press) var(--ease-out),
        background-color var(--dur-hover) ease,
        color var(--dur-hover) ease;
    }
    .card:focus-within .pool-actions .more,
    .pool-actions.visible .more {
      opacity: 1;
    }
    :global(html.pm-dragging) .card .more,
    :global(html.pm-dragging) .card::after {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card:has(> .link:active) {
      transform: none;
    }
    .chevron {
      transition: none;
    }
  }
</style>
