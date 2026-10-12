<!--
  Pastille de couleur, code et nom d'un projet sur une ligne (lignes d'un pool déplié, fantôme de glissement).
-->
<script lang="ts">
  import { truncatedTitle } from '$lib/components/shell/truncate';
  import type { Project } from '$lib/types/Project';

  let { project, archivedPill = false }: { project: Project; archivedPill?: boolean } = $props();
</script>

<span class="chip" class:archived={project.archived}>
  <span class="dot" style:--c={project.color} aria-hidden="true"></span>
  <span class="code">{project.code}</span>
  <span class="name" {@attach truncatedTitle}>{project.name}</span>
  {#if archivedPill && project.archived}
    <span class="pill">Archivé</span>
  {/if}
</span>

<style>
  .chip {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 999px;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  }

  .code {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .pill {
    flex: none;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
  }

  /* Archivé : en retrait, mais lisible. */
  .archived .dot,
  .archived .code,
  .archived .name {
    opacity: 0.6;
  }

  @media (prefers-color-scheme: dark) {
    .dot {
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14);
    }
  }
</style>
