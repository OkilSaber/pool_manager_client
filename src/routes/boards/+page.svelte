<script lang="ts" module>
  /** La cascade d'apparition ne se joue qu'au premier chargement réussi de la session. */
  let staggerPlayed = false;
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
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import DropdownMenu from '$lib/components/shell/DropdownMenu.svelte';
  import { errorMessage } from '$lib/errors';
  import FormError from '$lib/components/shell/FormError.svelte';
  import MenuItem from '$lib/components/shell/MenuItem.svelte';
  import { truncatedTitle } from '$lib/components/shell/truncate';
  import { DUR, easeOut, easeOutSoft, reducedMotion } from '$lib/motion';
  import { boardsCache } from '$lib/stores/boards-cache';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Board } from '$lib/types/Board';

  const STAGGER_STEP = 35;
  const STAGGER_MAX = 12;

  const cacheKey = `${getServerUrl()}#${session.user?.id ?? -1}`;
  const still = reducedMotion();

  let boards = $state<Board[] | null>(boardsCache.get(cacheKey));
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let showSkeleton = $state(false);
  let stagger = $state(false);

  /** Tuile dont le menu « … » est ouvert (une seule à la fois). */
  let menuFor = $state<number | null>(null);

  let createOpen = $state(false);
  let newName = $state('');
  let creating = $state(false);
  let createError = $state<string | null>(null);

  let toDelete = $state<Board | null>(null);
  let confirmOpen = $state(false);
  let deleting = $state(false);

  let grid = $state<HTMLUListElement>();
  let newButton: HTMLButtonElement;

  function remember(list: Board[]) {
    boardsCache.set(cacheKey, list);
  }

  async function load() {
    // « Réessayer » reste activable pendant le chargement (aria-disabled, pour garder le focus) : pas de doublon.
    if (loading) return;
    loading = true;
    // En cas de nouvel essai, l'écran d'erreur reste en place (spinner dans « Réessayer ») jusqu'à la réponse.
    // Rien pendant 200 ms (la plupart des réponses du LAN arrivent avant), puis le squelette.
    const skeletonTimer = setTimeout(() => (showSkeleton = true), 200);
    try {
      const list = await api.listBoards();
      if (!staggerPlayed && boards === null && list.length > 0) {
        stagger = true;
        setTimeout(() => (stagger = false), STAGGER_STEP * Math.min(list.length, STAGGER_MAX) + 300);
      }
      staggerPlayed = true;
      loadError = null;
      boards = list;
      remember(list);
    } catch (e) {
      // 401 : session expirée, le store de session renvoie déjà vers /login — pas d'erreur à afficher en partant.
      if (e instanceof ApiError && e.status === 401) return;
      // Liste en cache déjà affichée : un toast suffit, on ne casse pas l'écran.
      if (boards === null) loadError = errorMessage(e);
      else toast.error(errorMessage(e));
    } finally {
      clearTimeout(skeletonTimer);
      showSkeleton = false;
      loading = false;
    }
  }

  onMount(() => {
    // Sans session (rendu le temps que la garde du layout redirige vers /login) : pas de requête vouée au 401.
    if (session.user) load();
  });

  function initial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  // ---------- Création ----------

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
      const board = await api.createBoard(name);
      // Liste jamais chargée (erreur) : un cache réduit au seul nouveau tableau serait faux au retour.
      if (boards) remember([...$state.snapshot(boards), board]);
      await goto(`/boards/${board.id}`);
    } catch (err) {
      createError = errorMessage(err);
    } finally {
      creating = false;
    }
  }

  // ---------- Suppression ----------

  function askDelete(board: Board) {
    toDelete = board;
    confirmOpen = true;
  }

  async function confirmDelete(e: MouseEvent) {
    const target = toDelete;
    if (!target || deleting) return;
    const viaKeyboard = e.detail === 0;
    deleting = true;
    try {
      await api.deleteBoard(target.id);
      confirmOpen = false;
      // On laisse la modale sortir (et rendre le focus) avant d'effacer la tuile : on voit ce qui disparaît.
      setTimeout(async () => {
        const index = boards?.findIndex((b) => b.id === target.id) ?? -1;
        boards = boards?.filter((b) => b.id !== target.id) ?? null;
        if (boards) remember($state.snapshot(boards));
        if (viaKeyboard) {
          // Le déclencheur « … » a disparu avec la tuile : le focus clavier va à la voisine.
          await tick();
          const links = grid?.querySelectorAll<HTMLAnchorElement>('li:not([inert]) a.tile');
          const next = links && links.length ? links[Math.min(Math.max(index, 0), links.length - 1)] : newButton;
          next?.focus();
        }
      }, DUR.exit + 30);
      toast.success(`Tableau « ${target.name} » supprimé`);
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
   * Sortie d'une tuile supprimée : courte, opacité + léger rétrécissement (fondu seul si mouvement réduit).
   * Propriété `scale` (et non `transform`) : animate:flip sort la tuile du flux avec un
   * `transform: translate(…)` en ligne qu'il ne faut pas écraser, sinon elle sauterait en haut de la grille.
   */
  function tileOut(_node: Element) {
    return {
      duration: DUR.exit,
      easing: easeOutSoft,
      css: (t: number) => (still ? `opacity: ${t};` : `opacity: ${t}; scale: ${0.96 + 0.04 * t};`)
    };
  }
</script>

<svelte:head>
  <title>Tableaux · Pool Manager</title>
</svelte:head>

<div class="page">
  <div class="inner">
    <header class="page-head">
      <div class="title">
        <h1>Tableaux</h1>
        {#if boards && boards.length > 0}
          <span class="count num" title="{boards.length} tableau{boards.length > 1 ? 'x' : ''}">{boards.length}</span>
        {/if}
      </div>
      <button class="btn btn-primary" type="button" onclick={openCreate} bind:this={newButton}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        Nouveau tableau
      </button>
    </header>

    {#if boards}
      {#if boards.length === 0}
        <div class="state" in:fade={{ duration: 180, easing: easeOut }}>
          <svg class="illustration" width="132" height="88" viewBox="0 0 132 88" aria-hidden="true">
            <rect x="1" y="1" width="38" height="86" rx="7" class="col" />
            <rect x="47" y="1" width="38" height="86" rx="7" class="col" />
            <rect x="93" y="1" width="38" height="86" rx="7" class="col" />
            <rect x="7" y="9" width="26" height="14" rx="3.5" class="card" />
            <rect x="7" y="28" width="26" height="14" rx="3.5" class="card" />
            <rect x="53" y="9" width="26" height="14" rx="3.5" class="card accent" />
            <rect x="99" y="9" width="26" height="14" rx="3.5" class="card dashed" />
          </svg>
          <h2>Aucun tableau pour l'instant</h2>
          <p class="muted">Créez un tableau pour organiser le travail de l'équipe en colonnes, avec priorités, estimations et planning.</p>
          <button class="btn btn-primary" type="button" onclick={openCreate}>Créer un tableau</button>
        </div>
      {:else}
        <ul class="grid" bind:this={grid}>
          {#each boards as board, i (board.id)}
            <li
              class="tile-wrap"
              class:stagger
              class:raised={menuFor === board.id}
              style:--i={Math.min(i, STAGGER_MAX)}
              animate:flip={{ duration: still ? 0 : 220, easing: quartInOut }}
              out:tileOut
            >
              <a class="tile" href="/boards/{board.id}">
                <span class="mark" style:--h={hue(board.id)} aria-hidden="true">{initial(board.name)}</span>
                <span class="tile-body">
                  <span class="tile-name" {@attach truncatedTitle}>{board.name}</span>
                  <span class="pill" class:owner={board.role === 'owner'}>
                    {board.role === 'owner' ? 'Propriétaire' : 'Membre'}
                  </span>
                </span>
              </a>

              {#if board.role === 'owner'}
                <div class="tile-actions" class:visible={menuFor === board.id}>
                  <DropdownMenu
                    label="Actions du tableau {board.name}"
                    align="end"
                    width={176}
                    bind:open={
                      () => menuFor === board.id,
                      (v) => {
                        if (v) menuFor = board.id;
                        else if (menuFor === board.id) menuFor = null;
                      }
                    }
                  >
                    {#snippet trigger(props)}
                      <button {...props} class="btn btn-ghost btn-sm btn-icon more" aria-label="Actions du tableau {board.name}">
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                          <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
                          <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                          <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
                        </svg>
                      </button>
                    {/snippet}
                    <MenuItem danger onselect={() => askDelete(board)}>
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
    {:else if loadError}
      <div class="state" role="alert">
        <div class="state-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.4" fill="none" />
            <path d="M8 4.75v3.75M8 10.9v.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </div>
        <h2>Impossible de charger les tableaux</h2>
        <p class="muted">{loadError}</p>
        <div class="state-actions">
          <button class="btn" type="button" onclick={load} aria-disabled={loading || undefined} aria-busy={loading}>
            <BusyLabel busy={loading}>Réessayer</BusyLabel>
          </button>
          <a class="btn btn-ghost" href="/settings">Paramètres du serveur</a>
        </div>
      </div>
    {:else if showSkeleton}
      <ul class="grid" aria-busy="true" aria-label="Chargement des tableaux">
        {#each [62, 48, 71, 55, 40, 66] as width, i (i)}
          <li class="skeleton" in:fade|global={{ duration: 150, easing: easeOut }}>
            <span class="sk sk-mark"></span>
            <span class="sk-lines">
              <span class="sk sk-line" style:width="{width}%"></span>
              <span class="sk sk-pill"></span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<Modal bind:open={createOpen} title="Nouveau tableau" width={440}>
  <form id="new-board-form" class="create-form" onsubmit={create} novalidate>
    <div class="field">
      <label class="label" for="new-board-name">Nom du tableau</label>
      <!-- Dans un <dialog> natif, autofocus est le moyen prévu pour choisir le champ initial. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="new-board-name"
        class="input"
        type="text"
        maxlength="120"
        placeholder="Ex. Sprint 42, Roadmap produit…"
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
      form="new-board-form"
      disabled={!creating && !newName.trim()}
      aria-disabled={creating || undefined}
      aria-busy={creating}
    >
      <BusyLabel busy={creating}>Créer le tableau</BusyLabel>
    </button>
  {/snippet}
</Modal>

<Modal bind:open={confirmOpen} title="Supprimer le tableau" width={420}>
  <p class="confirm-text">
    Supprimer le tableau « <strong>{toDelete?.name}</strong> » ? Toutes ses cartes seront perdues.
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
      <BusyLabel busy={deleting}>Supprimer</BusyLabel>
    </button>
  {/snippet}
</Modal>

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

  /* ---------- En-tête ---------- */

  .page-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .title h1 {
    font-size: 20px;
    letter-spacing: -0.02em;
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

  /* ---------- États (vide / erreur) ---------- */

  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 400px;
    margin: 64px auto 0;
    text-align: center;
  }

  .state h2 {
    margin-top: 20px;
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
    border-radius: 999px;
    background: var(--danger-soft);
    color: var(--danger);
  }

  .state-icon + h2 {
    margin-top: 16px;
  }

  .state-actions {
    display: flex;
    gap: 8px;
  }

  .illustration .col {
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
