<!--
  Écran d'authentification (connexion / inscription), colonne étroite au centre optique.
  L'entrée (opacité + translateY 8 px, 260 ms) ne se joue qu'une fois par lancement de l'app :
  passer de « Connexion » à « Créer un compte » ne la rejoue pas.
-->
<script lang="ts" module>
  let entered = false;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getServerUrl } from '$lib/api';
  import Logo from './Logo.svelte';
  import { truncatedTitle } from './truncate';

  let {
    title,
    subtitle,
    children,
    alternate
  }: {
    title: string;
    subtitle?: string;
    children: Snippet;
    /** Ligne sous la carte (lien vers l'autre écran). */
    alternate?: Snippet;
  } = $props();

  const enter = !entered;
  entered = true;
  const server = getServerUrl();
</script>

<div class="auth">
  <div class="auth-inner" class:enter>
    <div class="brand">
      <Logo size={36} />
    </div>
    <h1 class="title">{title}</h1>
    {#if subtitle}
      <p class="subtitle">{subtitle}</p>
    {/if}

    <div class="card card-surface">
      {@render children()}
    </div>

    {#if alternate}
      <p class="alternate">{@render alternate()}</p>
    {/if}

    <p class="server">
      <span class="server-label">Serveur :</span>
      <span class="server-url" {@attach truncatedTitle}>{server}</span>
      <span class="server-sep" aria-hidden="true">·</span>
      <!-- « Modifier » seul est ambigu hors contexte (liste des liens d'un lecteur d'écran). -->
      <a href="/settings" aria-label="Modifier le serveur">Modifier</a>
    </p>
  </div>
</div>

<style>
  /*
   * Ancré en haut, au centre optique (~16 vh), plutôt que centré verticalement : quand un message
   * d'erreur apparaît sous le bouton, la carte ne grandit que vers le bas. Centrée, elle remonterait
   * de la moitié de la hauteur du message — y compris le champ que l'on est en train de saisir.
   */
  .auth {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    padding: clamp(32px, 16vh, 180px) 16px 40px;
    background: var(--bg);
  }

  .auth-inner {
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .enter {
    animation: auth-in 260ms var(--ease-out) backwards;
  }

  @keyframes auth-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  .brand {
    margin-bottom: 16px;
  }

  .title {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    text-align: center;
  }

  .subtitle {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
  }

  .card {
    width: 100%;
    margin-top: 24px;
    padding: 24px;
  }

  .alternate {
    margin: 20px 0 0;
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
  }

  .alternate :global(a),
  .server a {
    color: var(--accent);
    font-weight: 500;
    text-decoration: none;
    border-radius: 3px;
  }

  .server {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 4px;
    max-width: 100%;
    margin: 32px 0 0;
    font-size: 12px;
    /* text-subtle (~2.6:1 sur le fond clair) est réservé au séparateur décoratif */
    color: var(--text-muted);
  }

  .server-sep {
    color: var(--text-subtle);
  }

  .server-label {
    flex: none;
  }

  .server-url {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .server a {
    flex: none;
  }

  @media (hover: hover) and (pointer: fine) {
    .alternate :global(a:hover),
    .server a:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }

  /* Mouvement réduit : fondu seul */
  @media (prefers-reduced-motion: reduce) {
    .enter {
      animation-name: auth-fade;
    }
  }

  @keyframes auth-fade {
    from {
      opacity: 0;
    }
  }
</style>
