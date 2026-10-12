<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import AppHeader from '$lib/components/AppHeader.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Toaster from '$lib/components/Toaster.svelte';
  import { session } from '$lib/stores/session.svelte';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const PUBLIC = ['/login', '/signup', '/settings'];
  /** Pages réservées aux visiteurs non connectés (ou simple redirection, pour « / »). */
  const GUEST_ONLY = ['/login', '/signup', '/'];

  const path = $derived(page.url.pathname as string);
  const isPublic = $derived(PUBLIC.includes(path));
  /** La page demandée peut s'afficher telle quelle : sinon la garde redirige, et on n'en montre rien entre-temps. */
  const allowed = $derived(session.user ? !GUEST_ONLY.includes(path) : isPublic);
  /** Connecté, les paramètres du serveur gardent la barre d'application (ouverts depuis le menu du compte). */
  const showHeader = $derived(session.user != null && allowed);

  session.init();

  // Garde de navigation : non connecté → /login ; connecté sur login/signup → /pools.
  $effect(() => {
    if (!session.ready) return;
    if (!session.user && !isPublic) goto('/login', { replaceState: true });
    else if (session.user && GUEST_ONLY.includes(path)) goto('/pools', { replaceState: true });
  });
</script>

<div class="app">
  {#if session.ready}
    {#if showHeader}
      <AppHeader />
    {/if}
    <main>
      {#if allowed}
        {@render children()}
      {/if}
    </main>
  {:else}
    <!-- Vérification de la session enregistrée : rien pendant 300 ms (cas courant), puis un spinner. -->
    <div class="boot" role="status" aria-label="Connexion au serveur">
      <span class="boot-spinner"><Spinner size={16} /></span>
    </div>
  {/if}
</div>
<Toaster />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .boot {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }
  .boot-spinner {
    display: inline-flex;
    opacity: 0;
    animation: boot-appear 150ms ease 300ms forwards;
  }
  @keyframes boot-appear {
    to {
      opacity: 1;
    }
  }
</style>
