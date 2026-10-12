<!--
  Indicateur de chargement : petit, et qui tourne vite (≈ 600 ms par tour) —
  un spinner rapide donne l'impression d'un chargement plus court.
  Hérite de la couleur du texte (currentColor) pour se fondre dans les boutons.
-->
<script lang="ts">
  let { size = 14, label }: { size?: number; label?: string } = $props();
</script>

<span
  class="spinner"
  style:width="{size}px"
  style:height="{size}px"
  role={label ? 'status' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
></span>

<style>
  .spinner {
    display: inline-block;
    flex: none;
    border-radius: 999px;
    border: 2px solid color-mix(in srgb, currentColor 22%, transparent);
    border-top-color: currentColor;
    animation: spin 600ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Mouvement réduit : la rotation reste (c'est l'information « en cours »), mais plus calme. */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 1400ms;
    }
  }
</style>
