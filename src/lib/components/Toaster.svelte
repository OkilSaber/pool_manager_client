<!-- Pile de toasts en bas à droite : entrée depuis le bas, sortie plus courte que l'entrée. -->
<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import { DUR, easeOut, reducedMotion } from '$lib/motion';
  import { toast } from '$lib/stores/toast.svelte';

  const still = reducedMotion();
</script>

<ol class="toaster" aria-live="polite">
  {#each toast.items as t (t.id)}
    <li
      class="toast {t.kind}"
      animate:flip={{ duration: DUR.flip, easing: easeOut }}
      in:fly={{ y: still ? 0 : 24, duration: 260, easing: easeOut }}
      out:fade={{ duration: DUR.exit }}
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="msg">{t.message}</span>
      <button class="btn btn-ghost btn-sm btn-icon" aria-label="Fermer" onclick={() => toast.dismiss(t.id)}>
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </li>
  {/each}
</ol>

<style>
  .toaster {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(360px, calc(100vw - 40px));
    margin: 0;
    padding: 0;
    list-style: none;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 8px 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
  }
  .msg {
    flex: 1;
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 999px;
    background: var(--accent);
  }
  .error .dot {
    background: var(--danger);
  }
  .success .dot {
    background: var(--success);
  }
</style>
