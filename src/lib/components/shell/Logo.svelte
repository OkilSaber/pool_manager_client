<!-- Marque Pool Manager : trois colonnes de kanban de hauteurs différentes. -->
<script lang="ts">
  let { size = 20 }: { size?: number } = $props();
</script>

<svg class="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <rect width="24" height="24" rx="6" fill="var(--accent)" />
  <rect x="5" y="5.5" width="3.6" height="11" rx="1.4" fill="var(--accent-text)" />
  <rect x="10.2" y="5.5" width="3.6" height="7" rx="1.4" fill="var(--accent-text)" opacity="0.85" />
  <rect x="15.4" y="5.5" width="3.6" height="13" rx="1.4" fill="var(--accent-text)" opacity="0.7" />
</svg>

<style>
  .logo {
    display: block;
    flex: none;
  }
</style>
