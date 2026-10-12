<!--
  Message d'erreur de formulaire : apparaît par un fondu rapide, disparaît sans animation
  (on l'efface dès qu'une nouvelle tentative démarre — action souvent lancée au clavier).
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { easeOut } from '$lib/motion';

  let { message, unreachable = false }: { message: string | null; unreachable?: boolean } = $props();
</script>

{#if message}
  <div class="form-error" role="alert" in:fade={{ duration: 150, easing: easeOut }}>
    <svg class="icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M8 4.75v3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="8" cy="11" r="0.9" fill="currentColor" />
    </svg>
    <span class="text">
      {message}
      {#if unreachable}
        <a href="/settings">Vérifier l'adresse du serveur</a>
      {/if}
    </span>
  </div>
{/if}

<style>
  .form-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--danger-soft);
    /* Clair : --danger pur sur --danger-soft plafonne à ~4.4:1 à 13 px — un cran plus sombre pour passer AA. */
    color: color-mix(in srgb, var(--danger) 85%, black);
    font-size: 13px;
    line-height: 1.4;
  }

  /* Sombre : --danger est déjà éclairci pour le texte (~4.9:1 sur son fond teinté). */
  @media (prefers-color-scheme: dark) {
    .form-error {
      color: var(--danger);
    }
  }

  .icon {
    flex: none;
    /* Centrée sur la première ligne : (13 px × 1.4 − 14 px) / 2 ≈ 2 px */
    margin-top: 2px;
  }

  .text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  a {
    color: inherit;
    font-weight: 500;
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
  }
</style>
