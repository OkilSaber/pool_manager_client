<!--
  Contenu de bouton avec état « en cours », sans saut de mise en page.
  - Le libellé garde sa place (opacité 0, toujours lu par les lecteurs d'écran) et le spinner
    s'affiche par-dessus, centré : le bouton ne change ni de largeur ni de position.
  - Le spinner n'apparaît qu'après 120 ms : une réponse du LAN plus rapide ne fait pas clignoter
    le libellé (un spinner visible une seule frame ressemble à un bug).
  - Bascule instantanée, sans transition : l'action est souvent lancée au clavier (Entrée).

  Usage : <button aria-busy={pending} disabled={pending}><BusyLabel busy={pending}>Enregistrer</BusyLabel></button>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Spinner from '$lib/components/Spinner.svelte';

  const DELAY = 120;

  let { busy, children }: { busy: boolean; children: Snippet } = $props();

  let shown = $state(false);

  $effect(() => {
    if (!busy) {
      shown = false;
      return;
    }
    const timer = setTimeout(() => (shown = true), DELAY);
    return () => clearTimeout(timer);
  });
</script>

<span class="busy-label" data-busy={shown || undefined}>
  <span class="content">{@render children()}</span>
  {#if shown}
    <span class="spinner"><Spinner /></span>
  {/if}
</span>

<style>
  /* Libellé et spinner empilés dans la même cellule : la taille reste celle du libellé. */
  .busy-label {
    display: inline-grid;
    place-items: center;
  }

  .content,
  .spinner {
    grid-area: 1 / 1;
  }

  .content {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  [data-busy] .content {
    opacity: 0;
  }

  .spinner {
    display: inline-flex;
  }
</style>
