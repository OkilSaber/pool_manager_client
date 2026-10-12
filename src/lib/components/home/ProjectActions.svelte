<!--
  Menu « … » d'un projet sur l'accueil : réglages, et « Déplacer vers… » (alternative clavier au glisser-déposer).
-->
<script lang="ts">
  import DropdownMenu from '$lib/components/shell/DropdownMenu.svelte';
  import MenuItem from '$lib/components/shell/MenuItem.svelte';
  import { lastInputWasKeyboard } from '$lib/modality';
  import type { Project } from '$lib/types/Project';
  import { getHomeContext } from './home.svelte';

  let { project, size = 'md' }: { project: Project; size?: 'sm' | 'md' } = $props();

  const ctx = getHomeContext();
  const key = $derived(`project:${project.id}`);
  const targets = $derived(ctx.targets(project));
</script>

<div class="actions" class:visible={ctx.menuFor() === key} class:sm={size === 'sm'}>
  <DropdownMenu
    label="Actions du projet {project.code}"
    align="end"
    width={224}
    bind:open={
      () => ctx.menuFor() === key,
      (v) => {
        if (v) ctx.setMenu(key);
        else if (ctx.menuFor() === key) ctx.setMenu(null);
      }
    }
  >
    {#snippet trigger(props)}
      <button
        {...props}
        class="btn btn-ghost btn-sm btn-icon more"
        aria-label="Actions du projet {project.code} · {project.name}"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
          <circle cx="8" cy="8" r="1.25" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
        </svg>
      </button>
    {/snippet}

    <MenuItem onselect={() => ctx.openSettings(project)}>
      {#snippet icon()}
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path
            d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
          <circle cx="11" cy="4.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <circle cx="5" cy="11.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
      {/snippet}
      Réglages du projet…
    </MenuItem>

    {#if targets.length > 0}
      <div class="sep" role="separator"></div>
      <div class="group-label" aria-hidden="true">Déplacer vers…</div>
      <div class="group" role="group" aria-label="Déplacer vers">
        {#each targets as t (t.key ?? 'none')}
          <MenuItem onselect={() => ctx.move(project, t.key, lastInputWasKeyboard())}>
            {#snippet icon()}
              {#if t.key === null}
                <svg width="14" height="14" viewBox="0 0 16 16">
                  <path
                    d="M6 3.5H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 12.5h2M9.5 5.5 12 8l-2.5 2.5M12 8H6.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              {:else}
                <svg width="14" height="14" viewBox="0 0 16 16">
                  <rect x="2.5" y="3" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.3" />
                  <path d="M2.5 6.5h11" stroke="currentColor" stroke-width="1.3" />
                </svg>
              {/if}
            {/snippet}
            {t.key === null ? 'Aucun pool' : t.label}
          </MenuItem>
        {/each}
      </div>
    {/if}
  </DropdownMenu>
</div>

<style>
  .sep {
    height: 1px;
    margin: 4px -4px;
    background: var(--border);
  }

  .group-label {
    padding: 6px 8px 4px;
    color: var(--text-subtle);
    font-size: 11px;
    font-weight: 500;
  }

  /* Beaucoup de pools : la liste défile plutôt que de déborder de la fenêtre. */
  .group {
    max-height: 232px;
    overflow-y: auto;
  }

  .actions.sm .more {
    width: 22px;
    height: 22px;
  }

  .actions.visible .more {
    background: var(--surface-3);
    color: var(--text);
  }

  /* Au repos, le « … » n'encombre pas : visible au survol de la ligne/tuile ou au focus. */
  @media (hover: hover) and (pointer: fine) {
    .more {
      opacity: 0;
    }
    :global(.pm-reveal:hover) .more {
      opacity: 1;
      transition:
        opacity 120ms ease,
        background-color var(--dur-hover) ease,
        color var(--dur-hover) ease;
    }
    :global(.pm-reveal:focus-within) .more,
    .actions.visible .more {
      opacity: 1;
    }
    /* Pendant un glissement, aucun « … » ne surgit sous le pointeur. */
    :global(html.pm-dragging) .more {
      opacity: 0;
    }
  }
</style>
