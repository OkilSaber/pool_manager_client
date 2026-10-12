<script lang="ts" module>
  import type { Project } from '$lib/types/Project';

  /** La cascade d'apparition ne se joue qu'au premier chargement réussi de la session. */
  let staggerPlayed = false;

  /**
   * Derniers projets connus (même clé que poolsCache : serveur + utilisateur). Gardé ici plutôt que dans
   * un store : seul l'accueil affiche cette liste, et revenir à l'accueil doit être instantané.
   */
  let projectsCache: { key: string; projects: Project[] } | null = null;
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { quartInOut } from 'svelte/easing';
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { api, ApiError, getServerUrl } from '$lib/api';
  import { hue } from '$lib/avatar';
  import Modal from '$lib/components/Modal.svelte';
  import ProjectFormDialog from '$lib/components/projects/ProjectFormDialog.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import DropdownMenu from '$lib/components/shell/DropdownMenu.svelte';
  import FormError from '$lib/components/shell/FormError.svelte';
  import MenuItem from '$lib/components/shell/MenuItem.svelte';
  import { truncatedTitle } from '$lib/components/shell/truncate';
  import { errorMessage } from '$lib/errors';
  import { lastInputWasKeyboard } from '$lib/modality';
  import { DUR, easeOut, easeOutSoft, reducedMotion } from '$lib/motion';
  import { poolsCache } from '$lib/stores/pools-cache';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Pool } from '$lib/types/Pool';

  const STAGGER_STEP = 35;
  const STAGGER_MAX = 12;

  const cacheKey = `${getServerUrl()}#${session.user?.id ?? -1}`;
  const still = reducedMotion();

  let pools = $state<Pool[] | null>(poolsCache.get(cacheKey));
  let projects = $state<Project[] | null>(projectsCache?.key === cacheKey ? projectsCache.projects : null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let showSkeleton = $state(false);
  let stagger = $state(false);
  let showArchived = $state(false);

  const ready = $derived(pools !== null && projects !== null);
  /** Projets sans pool : l'API renvoie aussi ceux des pools, affichés sur la page de chaque pool. */
  const standalone = $derived((projects ?? []).filter((p) => p.pool_id === null));
  const activeProjects = $derived(standalone.filter((p) => !p.archived));
  const archivedProjects = $derived(standalone.filter((p) => p.archived));
  const shownProjects = $derived(showArchived ? [...activeProjects, ...archivedProjects] : activeProjects);

  /** Tuile de pool dont le menu « … » est ouvert (une seule à la fois). */
  let menuFor = $state<number | null>(null);

  let createOpen = $state(false);
  let newName = $state('');
  let creating = $state(false);
  let createError = $state<string | null>(null);

  let projectOpen = $state(false);

  let toDelete = $state<Pool | null>(null);
  let confirmOpen = $state(false);
  let deleting = $state(false);

  let poolGrid = $state<HTMLUListElement>();
  let newPoolButton = $state<HTMLButtonElement>();

  function rememberPools(list: Pool[]) {
    poolsCache.set(cacheKey, list);
  }

  function rememberProjects(list: Project[]) {
    projectsCache = { key: cacheKey, projects: list };
  }

  async function load() {
    // « Réessayer » reste activable pendant le chargement (aria-disabled, pour garder le focus) : pas de doublon.
    if (loading) return;
    loading = true;
    // En cas de nouvel essai, l'écran d'erreur reste en place (spinner dans « Réessayer ») jusqu'à la réponse.
    // Rien pendant 200 ms (la plupart des réponses du LAN arrivent avant), puis le squelette.
    const skeletonTimer = setTimeout(() => (showSkeleton = true), 200);
    try {
      const [poolList, projectList] = await Promise.all([api.listPools(), api.listProjects()]);
      const tiles = poolList.length + projectList.filter((p) => p.pool_id === null && !p.archived).length;
      if (!staggerPlayed && !ready && tiles > 0) {
        stagger = true;
        setTimeout(() => (stagger = false), STAGGER_STEP * Math.min(tiles, STAGGER_MAX) + 300);
      }
      staggerPlayed = true;
      loadError = null;
      pools = poolList;
      projects = projectList;
      rememberPools(poolList);
      rememberProjects(projectList);
    } catch (e) {
      // 401 : session expirée, le store de session renvoie déjà vers /login — pas d'erreur à afficher en partant.
      if (e instanceof ApiError && e.status === 401) return;
      // Listes en cache déjà affichées : un toast suffit, on ne casse pas l'écran.
      if (!ready) loadError = errorMessage(e);
      else toast.error(errorMessage(e));
    } finally {
      clearTimeout(skeletonTimer);
      showSkeleton = false;
      loading = false;
    }
  }

  /** Revalidation discrète des projets (après la suppression d'un pool, ses projets redeviennent sans pool). */
  async function refreshProjects() {
    try {
      const list = await api.listProjects();
      projects = list;
      rememberProjects(list);
    } catch {
      // Sans gravité : la prochaine visite revalidera.
    }
  }

  onMount(() => {
    // Sans session (rendu le temps que la garde du layout redirige vers /login) : pas de requête vouée au 401.
    if (session.user) load();
  });

  function initial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  function projectCount(n: number): string {
    if (n === 0) return 'Aucun projet';
    return `${n} projet${n > 1 ? 's' : ''}`;
  }

  // ---------- Création d'un pool ----------

  function openCreate() {
    newName = '';
    createError = null;
    createOpen = true;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    creating = true;
    createError = null;
    try {
      const pool = await api.createPool(name);
      // Liste jamais chargée (erreur) : un cache réduit au seul nouveau pool serait faux au retour.
      if (pools) rememberPools([...$state.snapshot(pools), pool]);
      await goto(`/pools/${pool.id}`);
    } catch (err) {
      createError = errorMessage(err);
    } finally {
      creating = false;
    }
  }

  // ---------- Création d'un projet ----------

  async function onProjectSaved(project: Project) {
    if (projects) rememberProjects([...$state.snapshot(projects), project]);
    await goto(project.pool_id !== null ? `/pools/${project.pool_id}` : `/projects/${project.id}`);
  }

  // ---------- Suppression d'un pool ----------

  function askDelete(pool: Pool) {
    toDelete = pool;
    confirmOpen = true;
  }

  async function confirmDelete(e: MouseEvent) {
    const target = toDelete;
    if (!target || deleting) return;
    const viaKeyboard = e.detail === 0;
    deleting = true;
    try {
      await api.deletePool(target.id);
      confirmOpen = false;
      // On laisse la modale sortir (et rendre le focus) avant d'effacer la tuile : on voit ce qui disparaît.
      setTimeout(async () => {
        const index = pools?.findIndex((p) => p.id === target.id) ?? -1;
        pools = pools?.filter((p) => p.id !== target.id) ?? null;
        if (pools) rememberPools($state.snapshot(pools));
        if (viaKeyboard) {
          // Le déclencheur « … » a disparu avec la tuile : le focus clavier va à la voisine.
          await tick();
          const links = poolGrid?.querySelectorAll<HTMLAnchorElement>('li:not([inert]) a.tile');
          const next = links && links.length ? links[Math.min(Math.max(index, 0), links.length - 1)] : newPoolButton;
          next?.focus();
        }
      }, DUR.exit + 30);
      toast.success(`Pool « ${target.name} » supprimé`);
      // Les projets du pool redeviennent sans pool : ceux dont on est propriétaire apparaissent ci-dessous.
      refreshProjects();
    } catch (err) {
      toast.error(errorMessage(err));
      // 404 : déjà supprimé ailleurs ; 403 : plus propriétaire. La tuile est périmée : on ferme et on revalide
      // la liste, au lieu de laisser une confirmation qui échouera à chaque essai.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        confirmOpen = false;
        load();
      }
    } finally {
      deleting = false;
    }
  }

  // ---------- Mouvement ----------

  /**
   * Sortie d'une tuile : courte, opacité + léger rétrécissement (fondu seul si mouvement réduit).
   * Propriété `scale` (et non `transform`) : animate:flip sort la tuile du flux avec un
   * `transform: translate(…)` en ligne qu'il ne faut pas écraser, sinon elle sauterait en haut de la grille.
   */
  function tileOut(_node: Element) {
    return {
      duration: lastInputWasKeyboard() ? 0 : DUR.exit,
      easing: easeOutSoft,
      css: (t: number) => (still ? `opacity: ${t};` : `opacity: ${t}; scale: ${0.96 + 0.04 * t};`)
    };
  }

  /** Entrée des projets archivés révélés à la souris ; au clavier, aucune animation. */
  function tileIn(_node: Element) {
    return {
      duration: lastInputWasKeyboard() ? 0 : 200,
      easing: easeOut,
      css: (t: number) => (still ? `opacity: ${t};` : `opacity: ${t}; translate: 0 ${(1 - t) * 6}px;`)
    };
  }
</script>

<svelte:head>
  <title>Accueil · Pool Manager</title>
</svelte:head>

{#snippet plusIcon()}
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
  </svg>
{/snippet}

{#snippet poolsHead(count: number | null)}
  <header class="section-head">
    <div class="title">
      <h2 id="pools-title">Pools</h2>
      {#if count}
        <span class="count num" title="{count} pool{count > 1 ? 's' : ''}">{count}</span>
      {/if}
    </div>
    <button class="btn btn-sm" type="button" onclick={openCreate} bind:this={newPoolButton}>
      {@render plusIcon()}
      Nouveau pool
    </button>
  </header>
{/snippet}

{#snippet projectsHead(count: number | null)}
  <header class="section-head">
    <div class="title">
      <h2 id="projects-title">Projets sans pool</h2>
      {#if count}
        <span class="count num" title="{count} projet{count > 1 ? 's' : ''} actif{count > 1 ? 's' : ''}">{count}</span>
      {/if}
    </div>
    <div class="head-actions">
      {#if archivedProjects.length > 0}
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          aria-pressed={showArchived}
          onclick={() => (showArchived = !showArchived)}
        >
          {showArchived ? 'Masquer les archivés' : `Afficher les archivés (${archivedProjects.length})`}
        </button>
      {/if}
      <button class="btn btn-sm" type="button" onclick={() => (projectOpen = true)}>
        {@render plusIcon()}
        Nouveau projet
      </button>
    </div>
  </header>
{/snippet}

{#snippet skeletonGrid(label: string, widths: number[])}
  <ul class="grid" aria-busy="true" aria-label={label}>
    {#each widths as width, i (i)}
      <li class="skeleton" in:fade|global={{ duration: 150, easing: easeOut }}>
        <span class="sk sk-mark"></span>
        <span class="sk-lines">
          <span class="sk sk-line" style:width="{width}%"></span>
          <span class="sk sk-pill"></span>
        </span>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="page">
  <div class="inner">
    <h1 class="page-title">Accueil</h1>

    {#if pools && projects}
      <section class="section" aria-labelledby="pools-title">
        {@render poolsHead(pools.length)}

        {#if pools.length === 0}
          <div class="empty" in:fade={{ duration: 180, easing: easeOut }}>
            <svg class="illustration" width="72" height="48" viewBox="0 0 72 48" aria-hidden="true">
              <rect x="1" y="1" width="70" height="46" rx="8" class="frame" />
              <rect x="9" y="10" width="24" height="12" rx="3" class="card accent" />
              <rect x="39" y="10" width="24" height="12" rx="3" class="card" />
              <rect x="9" y="27" width="24" height="12" rx="3" class="card" />
              <rect x="39" y="27" width="24" height="12" rx="3" class="card dashed" />
            </svg>
            <div class="empty-text">
              <h3>Aucun pool pour l'instant</h3>
              <p class="muted">
                Un pool réunit plusieurs projets et leurs membres sur un même tableau, avec des colonnes communes.
              </p>
            </div>
            <button class="btn btn-primary btn-sm" type="button" onclick={openCreate}>Créer un pool</button>
          </div>
        {:else}
          <ul class="grid" bind:this={poolGrid}>
            {#each pools as pool, i (pool.id)}
              <li
                class="tile-wrap"
                class:stagger
                class:raised={menuFor === pool.id}
                style:--i={Math.min(i, STAGGER_MAX)}
                animate:flip={{ duration: still ? 0 : 220, easing: quartInOut }}
                out:tileOut
              >
                <a class="tile" href="/pools/{pool.id}">
                  <span class="mark" style:--h={hue(pool.id)} aria-hidden="true">{initial(pool.name)}</span>
                  <span class="tile-body">
                    <span class="tile-name" {@attach truncatedTitle}>{pool.name}</span>
                    <span class="meta">
                      <span class="pill" class:owner={pool.role === 'owner'}>
                        {pool.role === 'owner' ? 'Propriétaire' : 'Membre'}
                      </span>
                      <span class="meta-text num">{projectCount(pool.project_count)}</span>
                    </span>
                  </span>
                </a>

                {#if pool.role === 'owner'}
                  <div class="tile-actions" class:visible={menuFor === pool.id}>
                    <DropdownMenu
                      label="Actions du pool {pool.name}"
                      align="end"
                      width={176}
                      bind:open={
                        () => menuFor === pool.id,
                        (v) => {
                          if (v) menuFor = pool.id;
                          else if (menuFor === pool.id) menuFor = null;
                        }
                      }
                    >
                      {#snippet trigger(props)}
                        <button {...props} class="btn btn-ghost btn-sm btn-icon more" aria-label="Actions du pool {pool.name}">
                          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                            <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
                            <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                            <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
                          </svg>
                        </button>
                      {/snippet}
                      <MenuItem danger onselect={() => askDelete(pool)}>
                        {#snippet icon()}
                          <svg width="14" height="14" viewBox="0 0 16 16">
                            <path
                              d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4 4.25l.6 8.4a1.25 1.25 0 0 0 1.25 1.1h4.3a1.25 1.25 0 0 0 1.25-1.1l.6-8.4"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.3"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                          </svg>
                        {/snippet}
                        Supprimer…
                      </MenuItem>
                    </DropdownMenu>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="section" aria-labelledby="projects-title">
        {@render projectsHead(activeProjects.length)}

        {#if shownProjects.length === 0}
          <div class="empty" in:fade={{ duration: 180, easing: easeOut }}>
            <svg class="illustration" width="72" height="48" viewBox="0 0 72 48" aria-hidden="true">
              <rect x="1" y="1" width="70" height="46" rx="8" class="frame" />
              <circle cx="14" cy="15" r="4" class="dot" />
              <rect x="22" y="12" width="26" height="6" rx="3" class="card" />
              <rect x="10" y="26" width="52" height="12" rx="3" class="card dashed" />
            </svg>
            <div class="empty-text">
              <h3>{archivedProjects.length > 0 ? 'Aucun projet actif sans pool' : 'Aucun projet sans pool'}</h3>
              <p class="muted">
                Un projet sans pool n'est visible que de vous : pratique pour un suivi personnel. Vous pourrez le
                rattacher à un pool plus tard.
              </p>
            </div>
            <button class="btn btn-sm" type="button" onclick={() => (projectOpen = true)}>Créer un projet</button>
          </div>
        {:else}
          <ul class="grid">
            {#each shownProjects as project, i (project.id)}
              <li
                class="tile-wrap"
                class:stagger={stagger && !project.archived}
                class:archived={project.archived}
                style:--i={Math.min((pools?.length ?? 0) + i, STAGGER_MAX)}
                animate:flip={{ duration: still ? 0 : 220, easing: quartInOut }}
                in:tileIn
                out:tileOut
              >
                <a class="tile tile-project" href="/projects/{project.id}">
                  <span class="project-top">
                    <span class="dot" style:--c={project.color} aria-hidden="true"></span>
                    <span class="code">{project.code}</span>
                    {#if project.archived}
                      <span class="pill">Archivé</span>
                    {/if}
                  </span>
                  <span class="tile-name" {@attach truncatedTitle}>{project.name}</span>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else if loadError}
      <div class="state" role="alert">
        <div class="state-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.4" fill="none" />
            <path d="M8 4.75v3.75M8 10.9v.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </div>
        <h2>Impossible de charger vos pools et projets</h2>
        <p class="muted">{loadError}</p>
        <div class="state-actions">
          <button class="btn" type="button" onclick={load} aria-disabled={loading || undefined} aria-busy={loading}>
            <BusyLabel busy={loading}>Réessayer</BusyLabel>
          </button>
          <a class="btn btn-ghost" href="/settings">Paramètres du serveur</a>
        </div>
      </div>
    {:else if showSkeleton}
      <section class="section" aria-labelledby="pools-title">
        {@render poolsHead(null)}
        {@render skeletonGrid('Chargement des pools', [62, 48, 71])}
      </section>
      <section class="section" aria-labelledby="projects-title">
        {@render projectsHead(null)}
        {@render skeletonGrid('Chargement des projets', [55, 40, 66])}
      </section>
    {/if}
  </div>
</div>

<Modal bind:open={createOpen} title="Nouveau pool" width={440}>
  <form id="new-pool-form" class="create-form" onsubmit={create} novalidate>
    <div class="field">
      <label class="label" for="new-pool-name">Nom du pool</label>
      <!-- Dans un <dialog> natif, autofocus est le moyen prévu pour choisir le champ initial. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="new-pool-name"
        class="input"
        type="text"
        maxlength="120"
        placeholder="Ex. Équipe produit, Client Acme…"
        autocomplete="off"
        autofocus
        bind:value={newName}
        oninput={() => (createError = null)}
      />
    </div>
    <FormError message={createError} />
  </form>

  {#snippet footer()}
    <button class="btn" type="button" onclick={() => (createOpen = false)}>Annuler</button>
    <button
      class="btn btn-primary"
      type="submit"
      form="new-pool-form"
      disabled={!creating && !newName.trim()}
      aria-disabled={creating || undefined}
      aria-busy={creating}
    >
      <BusyLabel busy={creating}>Créer le pool</BusyLabel>
    </button>
  {/snippet}
</Modal>

<Modal bind:open={confirmOpen} title="Supprimer le pool" width={440}>
  <p class="confirm-text">
    Supprimer le pool « <strong>{toDelete?.name}</strong> » ?
  </p>
  <p class="confirm-text">
    Ses projets et leurs cartes ne sont pas supprimés : ils redeviennent des projets sans pool, visibles de leur
    seul propriétaire. Les autres membres du pool n'y auront plus accès.
  </p>

  {#snippet footer()}
    <!-- Action destructive : le focus initial va sur l'option sûre. -->
    <!-- svelte-ignore a11y_autofocus -->
    <button class="btn" type="button" autofocus onclick={() => (confirmOpen = false)}>Annuler</button>
    <button
      class="btn btn-destructive"
      type="button"
      onclick={confirmDelete}
      aria-disabled={deleting || undefined}
      aria-busy={deleting}
    >
      <BusyLabel busy={deleting}>Supprimer le pool</BusyLabel>
    </button>
  {/snippet}
</Modal>

<ProjectFormDialog bind:open={projectOpen} defaultPoolId={null} onsaved={onProjectSaved} />

<style>
  .page {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .inner {
    max-width: 1120px;
    margin: 0 auto;
    padding: 28px 32px 48px;
  }

  .page-title {
    margin-bottom: 20px;
    font-size: 20px;
    letter-spacing: -0.02em;
  }

  /* ---------- Sections ---------- */

  .section + .section {
    margin-top: 36px;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 28px;
    margin-bottom: 12px;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .title h2 {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Rond pour un chiffre, pilule au-delà */
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }

  /* ---------- Grille ---------- */

  .grid {
    /* Bloc conteneur des tuiles qui sortent (animate:flip les passe en absolute) */
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tile-wrap {
    position: relative;
    /* Le menu ouvert passe au-dessus des tuiles voisines ; on ne redescend qu'après sa sortie. */
    transition:
      transform var(--dur-press) var(--ease-out),
      z-index 0s linear var(--dur-exit);
  }

  .tile-wrap.raised {
    z-index: 3;
    transition:
      transform var(--dur-press) var(--ease-out),
      z-index 0s;
  }

  /* Pression : toute la tuile (lien + bouton « … ») réagit ensemble */
  .tile-wrap:has(> .tile:active) {
    transform: scale(0.98);
  }

  .stagger {
    animation: tile-in 240ms var(--ease-out) backwards;
    animation-delay: calc(var(--i) * 35ms);
  }

  @keyframes tile-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 20px;
    min-height: 112px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--text);
    text-decoration: none;
    transition: border-color var(--dur-hover) ease;
  }

  /*
   * Ombre de survol portée par un pseudo-élément dont on anime l'opacité (composité) plutôt que
   * box-shadow (repeint à chaque frame). Effet de bord voulu : l'anneau de focus (box-shadow)
   * n'est plus transitionné — il apparaît instantanément à la navigation clavier.
   */
  .tile::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    box-shadow: var(--shadow-md);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-hover) ease;
  }

  .tile:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus);
    /* Focus clavier : instantané */
    transition-duration: 0s;
  }

  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 650;
    color: hsl(var(--h) 50% 34%);
    background: hsl(var(--h) 70% 92%);
  }

  @media (prefers-color-scheme: dark) {
    .mark {
      color: hsl(var(--h) 70% 84%);
      background: hsl(var(--h) 32% 25%);
    }
  }

  .tile-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
  }

  .tile-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .meta-text {
    color: var(--text-muted);
    font-size: 12px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
  }

  .pill.owner {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* Sombre : l'accent pur sur accent-soft plafonne vers 3.7:1 à 11 px — on l'éclaircit pour passer AA. */
  @media (prefers-color-scheme: dark) {
    .pill.owner {
      color: color-mix(in srgb, var(--accent) 65%, white);
    }
  }

  /* ---------- Tuiles de projet ---------- */

  .tile-project {
    min-height: 96px;
  }

  .project-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dot {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 999px;
    background: var(--c);
    /* Liseré discret : une couleur très claire (ou très sombre) reste lisible sur la surface. */
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  }

  .code {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .project-top .pill {
    margin-left: auto;
  }

  /* Archivé : en retrait, mais le nom reste lisible (opacité sur le contenu, pas sur la bordure). */
  .archived .tile {
    background: var(--surface-2);
    box-shadow: none;
  }

  .archived .project-top,
  .archived .tile-name {
    opacity: 0.6;
  }

  /* Centré verticalement sur la pastille (1 px de bordure + 16 px + 28 / 2 = 31 px ; bouton de 26 px). */
  .tile-actions {
    position: absolute;
    top: 18px;
    right: 10px;
  }

  /*
   * Couleur de .btn-ghost (text-muted) conservée : text-subtle tombait à ~2.6:1, sous le 3:1 exigé
   * pour une icône d'action. Menu ouvert : le déclencheur reste marqué, comme le menu du compte.
   */
  .tile-actions.visible .more {
    background: var(--surface-3);
    color: var(--text);
  }

  /* ---------- Section vide ---------- */

  .empty {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
  }

  .empty-text {
    flex: 1;
    min-width: 0;
  }

  .empty h3 {
    font-size: 13px;
    font-weight: 600;
  }

  .empty p {
    margin: 4px 0 0;
    max-width: 520px;
    font-size: 13px;
    line-height: 1.5;
  }

  .empty .btn {
    flex: none;
  }

  .illustration {
    flex: none;
  }

  .illustration .frame {
    fill: var(--surface-2);
    stroke: var(--border);
  }

  .illustration .card {
    fill: var(--surface);
    stroke: var(--border-strong);
  }

  .illustration .card.accent {
    fill: var(--accent-soft);
    stroke: var(--accent);
  }

  .illustration .card.dashed {
    fill: none;
    stroke-dasharray: 3 3;
  }

  .illustration .dot {
    fill: var(--accent);
  }

  @media (max-width: 640px) {
    .empty {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  /* ---------- Erreur de chargement ---------- */

  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 400px;
    margin: 64px auto 0;
    text-align: center;
  }

  .state h2 {
    font-size: 15px;
  }

  .state p {
    margin: 6px 0 20px;
    font-size: 13px;
    line-height: 1.5;
  }

  /* Même pastille que l'erreur de la page d'un tableau (ton « erreur » : chargement impossible). */
  .state-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-bottom: 16px;
    border-radius: 999px;
    background: var(--danger-soft);
    color: var(--danger);
  }

  .state-actions {
    display: flex;
    gap: 8px;
  }

  /* ---------- Squelette ---------- */

  .skeleton {
    /* Reflet : blanc en clair ; en sombre, la surface est plus foncée que les barres et ferait un reflet sombre. */
    --shimmer: color-mix(in srgb, var(--surface) 70%, transparent);
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 20px;
    min-height: 112px;
    padding: 16px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, var(--shimmer), transparent);
    transform: translateX(-100%);
    /* Mouvement continu : linéaire. Balayage sur 60 % du cycle, puis une pause. */
    animation: shimmer 1.6s linear infinite;
  }

  @media (prefers-color-scheme: dark) {
    .skeleton {
      --shimmer: rgb(255 255 255 / 0.05);
    }
    .dot {
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14);
    }
  }

  @keyframes shimmer {
    60%,
    100% {
      transform: translateX(100%);
    }
  }

  .sk {
    display: block;
    border-radius: 6px;
    background: var(--surface-2);
  }

  .sk-mark {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
  }

  .sk-lines {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sk-line {
    height: 12px;
  }

  .sk-pill {
    width: 64px;
    height: 16px;
    border-radius: 999px;
  }

  /* ---------- Modales ---------- */

  .create-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .confirm-text {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.55;
  }

  .confirm-text + .confirm-text {
    margin-top: 8px;
  }

  .confirm-text strong {
    color: var(--text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  /* ---------- Survol (pointeur fin uniquement) ---------- */

  @media (hover: hover) and (pointer: fine) {
    .tile:hover {
      border-color: var(--border-strong);
    }
    .tile:hover::after {
      opacity: 1;
    }
    .archived .tile:hover .project-top,
    .archived .tile:hover .tile-name {
      opacity: 0.85;
    }

    /*
     * Le bouton « … » n'encombre pas la grille : il apparaît au survol ou au focus.
     * Seule l'apparition au survol est fondue (120 ms) ; au focus clavier et à la sortie : instantané.
     * L'opacité est portée par le bouton et non par .tile-actions : sinon, fermer le menu en cliquant
     * hors de la tuile masquait d'un coup tout le conteneur, et le menu ne jouait jamais sa sortie.
     */
    .more {
      opacity: 0;
    }
    .tile-wrap:hover .more {
      opacity: 1;
      transition:
        opacity 120ms ease,
        transform var(--dur-press) var(--ease-out),
        background-color var(--dur-hover) ease,
        color var(--dur-hover) ease;
    }
    .tile-wrap:focus-within .more,
    .tile-actions.visible .more {
      opacity: 1;
    }
  }

  /* ---------- Mouvement réduit : fondus conservés, déplacements retirés ---------- */

  @media (prefers-reduced-motion: reduce) {
    .tile-wrap:has(> .tile:active) {
      transform: none;
    }
    .stagger {
      animation-name: tile-fade;
    }
    .skeleton::after {
      animation: none;
      display: none;
    }
  }

  @keyframes tile-fade {
    from {
      opacity: 0;
    }
  }
</style>
