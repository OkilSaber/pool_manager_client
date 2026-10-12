<!-- Tableau d'un pool : cartes de tous ses projets non archivés. -->
<script lang="ts">
  import { page } from '$app/state';
  import BoardPage from '$lib/components/board/BoardPage.svelte';

  const id = $derived(Number(page.params.id));
</script>

<BoardPage ref={{ kind: 'pool', id }} />
