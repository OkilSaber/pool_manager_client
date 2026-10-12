<!-- Tableau d'un projet : ses seules cartes (colonnes de son pool, ou les siennes s'il est autonome). -->
<script lang="ts">
  import { page } from '$app/state';
  import BoardPage from '$lib/components/board/BoardPage.svelte';

  const id = $derived(Number(page.params.id));
</script>

<BoardPage ref={{ kind: 'project', id }} />
