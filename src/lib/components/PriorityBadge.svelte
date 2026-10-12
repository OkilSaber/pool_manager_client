<script lang="ts">
  import { priority } from '$lib/priority';

  let { value, showName = false }: { value: number; showName?: boolean } = $props();
  const info = $derived(priority(value));
</script>

<span class="badge" style:--c={info.color} title="{info.label} · {info.name}">
  {info.label}{#if showName}<span class="name">{info.name}</span>{/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 6px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    /* Teinte pure sur sa propre teinte : ~2:1 pour P1/P2 en clair. Mêlée au texte, elle fonce en clair et
       s'éclaircit en sombre (même règle que le sélecteur de priorité de la modale). */
    color: color-mix(in srgb, var(--c) 60%, var(--text));
    background: color-mix(in srgb, var(--c) 14%, transparent);
  }
  .name {
    font-weight: 500;
    letter-spacing: 0;
  }
</style>
