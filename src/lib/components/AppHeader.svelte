<!-- Barre d'application (48 px) : marque à gauche, mise à jour éventuelle et menu du compte à droite. -->
<script lang="ts">
  import { page } from '$app/state';
  import { updates } from '$lib/stores/updates.svelte';
  import Logo from './shell/Logo.svelte';
  import UserMenu from './shell/UserMenu.svelte';
</script>

<header class="app-header">
  <a
    class="brand"
    href="/pools"
    aria-label="Pool Manager — Accueil"
    aria-current={page.url.pathname === '/pools' ? 'page' : undefined}
  >
    <Logo size={20} />
    <span class="brand-name">Pool Manager</span>
  </a>
  <div class="spacer"></div>
  {#if updates.available}
    <button class="update" type="button" onclick={() => (updates.dialogOpen = true)}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      Mise à jour <span class="num">v{updates.available.version}</span>
    </button>
  {/if}
  <UserMenu />
</header>

<style>
  .app-header {
    /* Au-dessus du contenu de la page pour que le menu du compte le recouvre */
    position: relative;
    z-index: 50;
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    height: 48px;
    /* Même retrait des deux côtés : les zones de survol de la marque et du menu sont à 12 px des bords. */
    padding: 0 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 8px 0 6px;
    border-radius: var(--radius);
    color: var(--text);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    text-decoration: none;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-hover) ease;
  }

  .brand:active {
    transform: scale(0.97);
  }

  .brand:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  .spacer {
    flex: 1;
  }

  .update {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: none;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    animation: update-in 200ms var(--ease-out);
    transition: transform var(--dur-press) var(--ease-out);
  }

  .update:active {
    transform: scale(0.97);
  }

  .update:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  @keyframes update-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
  }

  @media (hover: hover) and (pointer: fine) {
    .brand:hover {
      background: var(--surface-2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .brand:active,
    .update:active {
      transform: none;
    }

    .update {
      animation: none;
    }
  }
</style>
