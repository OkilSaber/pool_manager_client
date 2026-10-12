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
  import { onMount, tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { quartInOut } from 'svelte/easing';
  import { SvelteSet } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { api, ApiError, getServerUrl } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import DragGhost from '$lib/components/home/DragGhost.svelte';
  import PoolTile from '$lib/components/home/PoolTile.svelte';
  import ProjectTile from '$lib/components/home/ProjectTile.svelte';
  import {
    ProjectDrag,
    loadExpanded,
    saveExpanded,
    setHomeContext,
    type DropKey,
    type MoveTarget
  } from '$lib/components/home/home.svelte';
  import ProjectFormDialog from '$lib/components/projects/ProjectFormDialog.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import FormError from '$lib/components/shell/FormError.svelte';
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

  /** Projets de chaque pool (actifs d'abord, archivés ensuite), affichés quand la tuile est dépliée. */
  const byPool = $derived.by(() => {
    const map = new Map<number, Project[]>();
    for (const p of projects ?? []) {
      if (p.pool_id === null) continue;
      const list = map.get(p.pool_id);
      if (list) list.push(p);
      else map.set(p.pool_id, [p]);
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.archived) - Number(b.archived));
    return map;
  });

  /** Pools par nom : destinations proposées dans « Déplacer vers… ». */
  const poolsByName = $derived([...(pools ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'fr')));

  /**
   * Menu « … » ouvert (un seul à la fois) : `pool:<id>` ou `project:<id>`. Sa tuile passe au-dessus des voisines.
   */
  let menuFor = $state<string | null>(null);
  const raisedPool = $derived.by(() => {
    if (!menuFor) return null;
    if (menuFor.startsWith('pool:')) return Number(menuFor.slice(5));
    const id = Number(menuFor.slice(8));
    return projects?.find((p) => p.id === id)?.pool_id ?? null;
  });

  /** Pools dépliés, mémorisés d'une visite à l'autre. */
  const expanded = new SvelteSet<number>(loadExpanded());
  /** Projets dont le déplacement attend la réponse du serveur : ni glissables ni déplaçables d'ici là. */
  const pending = new SvelteSet<number>();

  let settingsOpen = $state(false);
  let settingsFor = $state<Project | undefined>(undefined);

  let pageEl = $state<HTMLDivElement>();

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

  /** Revalidation discrète des deux listes (compteurs des pools, cartes remappées…) après un déplacement. */
  async function refreshAll() {
    try {
      const [poolList, projectList] = await Promise.all([api.listPools(), api.listProjects()]);
      // Un autre déplacement est parti entre-temps : sa propre revalidation suivra.
      if (pending.size > 0) return;
      pools = poolList;
      projects = projectList;
      rememberPools(poolList);
      rememberProjects(projectList);
    } catch {
      // Sans gravité : l'état optimiste reste affiché, la prochaine visite revalidera.
    }
  }

  onMount(() => {
    // Sans session (rendu le temps que la garde du layout redirige vers /login) : pas de requête vouée au 401.
    if (session.user) load();
    return () => drag.destroy();
  });

  function toggleExpanded(id: number) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    saveExpanded(expanded);
  }

  // ---------- Déplacement d'un projet (glisser-déposer ou « Déplacer vers… ») ----------

  /**
   * Destinations permises (règles du serveur) : rattacher ou déplacer = propriétaire du projet (et membre du pool
   * cible : tous les pools listés ici sont les nôtres) ; détacher = propriétaire du projet ou du pool.
   */
  function targets(project: Project): MoveTarget[] {
    if (!pools || pending.has(project.id)) return [];
    const isOwner = project.owner_id === session.user?.id;
    const isPoolOwner = project.pool_id !== null && pools.some((p) => p.id === project.pool_id && p.role === 'owner');
    const list: MoveTarget[] = [];
    if (isOwner) {
      for (const pool of poolsByName) if (pool.id !== project.pool_id) list.push({ key: pool.id, label: pool.name });
    }
    if (project.pool_id !== null && (isOwner || isPoolOwner)) list.push({ key: null, label: 'Aucun pool' });
    return list;
  }

  const canDrop = (project: Project, key: DropKey) => targets(project).some((t) => t.key === key);

  const drag = new ProjectDrag({
    canDrop,
    onDrop: (project, key) => move(project, key, false),
    scroller: () => pageEl
  });

  /** Indication portée par le fantôme au-dessus d'une cible. */
  const dragHint = $derived.by(() => {
    const over = drag.over;
    if (over === undefined || !drag.project) return null;
    if (!drag.allowed) return { text: 'Réservé au propriétaire du projet', denied: true };
    if (over === null) return { text: 'Détacher du pool', denied: false };
    return { text: `Rattacher à ${pools?.find((p) => p.id === over)?.name ?? 'ce pool'}`, denied: false };
  });

  /** Compteur de projets actifs des pools quittés / rejoints (les archivés n'y comptent pas). */
  function shiftCount(from: number | null, to: number | null) {
    if (!pools) return;
    pools = pools.map((p) =>
      p.id === from
        ? { ...p, project_count: Math.max(0, p.project_count - 1) }
        : p.id === to
          ? { ...p, project_count: p.project_count + 1 }
          : p
    );
  }

  async function move(project: Project, key: DropKey, viaKeyboard: boolean) {
    if (!projects || pending.has(project.id)) return;
    const original = projects.find((p) => p.id === project.id);
    if (!original || original.pool_id === key) return;
    const from = original.pool_id;
    // Détaché sans en être propriétaire : le projet n'est plus visible de nous (il redevient privé à son propriétaire).
    const leaves = key === null && original.owner_id !== session.user?.id;
    const poolName = key === null ? null : (pools?.find((p) => p.id === key)?.name ?? 'ce pool');

    // Optimiste : le projet change de place tout de suite.
    pending.add(original.id);
    projects = leaves
      ? projects.filter((p) => p.id !== original.id)
      : projects.map((p) => (p.id === original.id ? { ...p, pool_id: key } : p));
    if (!original.archived) shiftCount(from, key);

    if (viaKeyboard) {
      // Au clavier, le focus suit le projet à sa nouvelle place (le déclencheur « … » a disparu avec lui).
      if (key !== null && !expanded.has(key)) toggleExpanded(key);
      if (key === null && original.archived) showArchived = true;
      await tick();
      document.querySelector<HTMLElement>(`[data-project-link="${original.id}"]`)?.focus();
    }

    try {
      const saved = await api.updateProject(original.id, { pool_id: key });
      if (!leaves && projects) projects = projects.map((p) => (p.id === saved.id ? saved : p));
      if (projects) rememberProjects($state.snapshot(projects));
      if (pools) rememberPools($state.snapshot(pools));
      toast.success(key === null ? `${saved.code} détaché du pool` : `${saved.code} rattaché à ${poolName}`);
    } catch (err) {
      // Retour à l'état d'avant, pour ce seul projet (un autre déplacement peut être en cours).
      if (projects) {
        projects = projects.some((p) => p.id === original.id)
          ? projects.map((p) => (p.id === original.id ? original : p))
          : [...projects, original];
      }
      if (!original.archived) shiftCount(key, from);
      if (!(err instanceof ApiError && err.status === 401)) toast.error(err);
    } finally {
      pending.delete(original.id);
      if (pending.size === 0) refreshAll();
    }
  }

  // ---------- Réglages d'un projet (clic droit, Maj+F10, menu « … ») ----------

  function openSettings(project: Project) {
    if (drag.phase !== 'idle') return;
    menuFor = null;
    settingsFor = $state.snapshot(project);
    settingsOpen = true;
  }

  function onSettingsSaved(saved: Project) {
    if (!projects) return;
    projects = projects.map((p) => (p.id === saved.id ? saved : p));
    rememberProjects($state.snapshot(projects));
  }

  // À la fermeture (enregistrement, suppression ou annulation) : revalidation des deux listes.
  let settingsWasOpen = false;
  $effect(() => {
    if (settingsOpen) settingsWasOpen = true;
    else if (settingsWasOpen) {
      settingsWasOpen = false;
      untrack(() => refreshAll());
    }
  });

  setHomeContext({
    drag,
    targets,
    canDrag: (project) => targets(project).length > 0,
    openSettings,
    move,
    menuFor: () => menuFor,
    setMenu: (key) => (menuFor = key)
  });

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
          const links = poolGrid?.querySelectorAll<HTMLAnchorElement>('li:not([inert]) a[href^="/pools/"]');
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

<div class="page" bind:this={pageEl}>
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
          <ul class="grid pool-grid" bind:this={poolGrid}>
            {#each pools as pool, i (pool.id)}
              <li
                class="tile-wrap"
                class:stagger
                class:raised={raisedPool === pool.id}
                style:--i={Math.min(i, STAGGER_MAX)}
                animate:flip={{ duration: still ? 0 : 220, easing: quartInOut }}
                out:tileOut
              >
                <PoolTile
                  {pool}
                  projects={byPool.get(pool.id) ?? []}
                  expanded={expanded.has(pool.id)}
                  ontoggle={() => toggleExpanded(pool.id)}
                  ondelete={askDelete}
                />
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section
        class="section drop-zone"
        aria-labelledby="projects-title"
        data-drop="none"
        data-drop-state={drag.stateOf(null)}
      >
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
                class:raised={menuFor === `project:${project.id}`}
                style:--i={Math.min((pools?.length ?? 0) + i, STAGGER_MAX)}
                animate:flip={{ duration: still ? 0 : 220, easing: quartInOut }}
                in:tileIn
                out:tileOut
              >
                <ProjectTile {project} />
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
<ProjectFormDialog bind:open={settingsOpen} project={settingsFor} onsaved={onSettingsSaved} />

<DragGhost {drag} hint={dragHint} />

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

  /* Tuiles de pool de hauteurs différentes (dépliées ou non) : pas d'étirement des voisines. */
  .pool-grid {
    align-items: start;
  }

  .tile-wrap {
    position: relative;
    /* Le menu ouvert passe au-dessus des tuiles voisines ; on ne redescend qu'après sa sortie. */
    transition: z-index 0s linear var(--dur-exit);
  }

  .tile-wrap.raised {
    z-index: 3;
    transition: z-index 0s;
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

  /* ---------- Zone « Projets sans pool » (y lâcher un projet le détache) ---------- */

  .drop-zone {
    position: relative;
    isolation: isolate;
  }

  .drop-zone::before {
    content: '';
    position: absolute;
    inset: -10px -12px -12px;
    z-index: -1;
    border: 1.5px dashed transparent;
    border-radius: calc(var(--radius-lg) + 6px);
    pointer-events: none;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .drop-zone[data-drop-state='can']::before {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .drop-zone[data-drop-state='over']::before {
    border-style: solid;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent-soft) 60%, transparent);
  }

  /* Pendant un glissement, le curseur dit ce qui se passera au relâchement. */
  :global(html.pm-dragging),
  :global(html.pm-dragging *) {
    cursor: grabbing !important;
  }

  :global(html.pm-drag-denied),
  :global(html.pm-drag-denied *) {
    cursor: not-allowed !important;
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

  /* ---------- Mouvement réduit : fondus conservés, déplacements retirés ---------- */

  @media (prefers-reduced-motion: reduce) {
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
