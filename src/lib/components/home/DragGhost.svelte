<!--
  Fantôme du projet glissé : suit le pointeur par translation seule (position fixe posée une fois),
  légèrement soulevé ; revient en ease-out à l'annulation, s'efface vite sur un dépôt réussi.
-->
<script lang="ts">
  import ProjectChip from './ProjectChip.svelte';
  import type { ProjectDrag } from './home.svelte';

  let { drag, hint }: { drag: ProjectDrag; hint: { text: string; denied: boolean } | null } = $props();
</script>

{#if drag.project && drag.phase !== 'idle'}
  <div
    class="ghost"
    data-phase={drag.phase}
    style:left="{drag.x0 - 14}px"
    style:top="{drag.y0 - 16}px"
    style:transform="translate3d({drag.dx}px, {drag.dy}px, 0)"
    aria-hidden="true"
  >
    <div class="lift">
      <div class="chip-box">
        <ProjectChip project={drag.project} />
      </div>
      {#if hint && drag.phase === 'dragging'}
        <div class="hint" class:denied={hint.denied}>
          {#if hint.denied}
            <svg width="12" height="12" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3" />
              <path d="M2.8 9.2 9.2 2.8" stroke="currentColor" stroke-width="1.3" />
            </svg>
          {:else}
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 6h7.5M6.5 3l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {/if}
          <span class="hint-text">{hint.text}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    z-index: 100;
    pointer-events: none;
    will-change: transform;
  }

  /* Annulation : retour au point de saisie. */
  .ghost[data-phase='returning'] {
    transition: transform 200ms var(--ease-out);
  }

  .lift {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    transform-origin: 14px 16px;
    transform: scale(1.03) rotate(-1.5deg);
    animation: lift 160ms var(--ease-out);
    transition:
      transform 200ms var(--ease-out),
      opacity 200ms var(--ease-out);
  }

  @keyframes lift {
    from {
      transform: scale(1) rotate(0deg);
    }
  }

  /* Retour : se repose (échelle et rotation retombent) et s'efface en arrivant. */
  [data-phase='returning'] .lift {
    transform: none;
    opacity: 0;
    transition:
      transform 200ms var(--ease-out),
      opacity 120ms ease 80ms;
  }

  /* Dépôt réussi : sortie courte, le projet apparaît à sa nouvelle place. */
  [data-phase='dropping'] .lift {
    transform: scale(0.96);
    opacity: 0;
    transition:
      transform 130ms var(--ease-out),
      opacity 130ms var(--ease-out);
  }

  .chip-box {
    display: flex;
    max-width: 280px;
    height: 34px;
    align-items: center;
    padding: 0 12px 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    color: var(--text);
  }

  .hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 280px;
    height: 24px;
    padding: 0 9px 0 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 500;
    box-shadow: var(--shadow-md);
  }

  .hint.denied {
    background: var(--surface);
    color: var(--danger);
    border: 1px solid var(--border);
  }

  .hint-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Mouvement réduit : pas de soulèvement ni de trajet retour, un simple fondu. */
  @media (prefers-reduced-motion: reduce) {
    .lift,
    [data-phase='returning'] .lift,
    [data-phase='dropping'] .lift {
      transform: none;
      animation: none;
    }
    .ghost[data-phase='returning'] {
      transition: none;
    }
  }
</style>
