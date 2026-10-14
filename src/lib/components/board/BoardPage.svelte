<!--
  Page d'un pool ou d'un projet : en-tête, filtres par projet (pool) et par type, vue Kanban ou Chronologie
  (?view=timeline, conservée au rechargement), et une modale de carte unique partagée par les deux vues
  (consultation d'une carte, ou création depuis une colonne).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Spinner from '$lib/components/Spinner.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { errorMessage } from '$lib/errors';
  import { board, type ScopeRef } from '$lib/stores/board.svelte';
  import { realtime } from '$lib/stores/realtime.svelte';
  import BoardHeader, { BOARD_VIEW_PANEL_ID, type BoardView } from './BoardHeader.svelte';
  import CardModal from './CardModal.svelte';
  import KanbanBoard from './KanbanBoard.svelte';
  import ProjectFilterBar from './ProjectFilterBar.svelte';

  let { ref }: { ref: ScopeRef } = $props();

  const kind = $derived(ref.kind);
  const id = $derived(ref.id);
  const validId = $derived(Number.isInteger(id) && id > 0);
  const view: BoardView = $derived(page.url.searchParams.get('view') === 'timeline' ? 'timeline' : 'kanban');

  // Le store garde l'éventuel tableau précédent : on n'affiche que celui demandé.
  // Il garde aussi le même tableau quand son rechargement échoue (ex. retour sur un pool qu'on vient
  // de quitter → 403) : l'erreur l'emporte alors sur les données périmées.
  const ready = $derived(validId && board.ref?.kind === kind && board.ref?.id === id && !board.error);

  $effect(() => {
    if (!validId) return;
    const target: ScopeRef = { kind, id };
    untrack(() => board.load(target));
  });

  // Temps réel : on suit le tableau affiché (rien pendant un chargement ou une erreur), plus rien en quittant la page.
  $effect(() => {
    const target = ready ? board.ref : null;
    untrack(() => realtime.watch(target));
  });
  $effect(() => () => realtime.watch(null));

  function setView(next: BoardView) {
    const url = new URL(page.url);
    if (next === 'kanban') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // ---------- Modale de carte ----------

  let modalOpen = $state(false);
  let modalCardId = $state<number | null>(null);
  /** Colonne de la carte en cours de création (null : consultation d'une carte existante). */
  let draftState = $state<number | null>(null);

  function openCard(cardId: number) {
    draftState = null;
    modalCardId = cardId;
    modalOpen = true;
  }

  function createCard(stateId: number) {
    modalCardId = null;
    draftState = stateId;
    modalOpen = true;
  }

  // ---------- Erreur ----------

  const noun = $derived(kind === 'pool' ? 'ce pool' : 'ce projet');

  const failure = $derived.by(() => {
    const missing = kind === 'pool' ? 'Pool introuvable' : 'Projet introuvable';
    if (!validId) return { title: missing, text: 'L’adresse ne correspond à aucun pool ni projet.', retry: false };
    const e = board.error;
    if (!e || ready) return null;
    if (board.errorStatus === 403)
      return {
        title: 'Accès refusé',
        text:
          kind === 'pool'
            ? 'Vous n’êtes pas membre de ce pool. Demandez à son propriétaire de vous inviter.'
            : 'Ce projet appartient à un pool dont vous n’êtes pas membre.',
        retry: false
      };
    if (board.errorStatus === 404)
      return { title: missing, text: `Il a peut-être été supprimé, ou vous n’avez plus accès à ${noun}.`, retry: false };
    return { title: kind === 'pool' ? 'Impossible de charger le pool' : 'Impossible de charger le projet', text: errorMessage(e), retry: true };
  });
</script>

<svelte:head>
  <title>{ready && board.title ? `${board.title} · Pool Manager` : 'Pool Manager'}</title>
</svelte:head>

<div class="board-page">
  {#if ready}
    <BoardHeader {view} onviewchange={setView} />
    {#if (board.kind === 'pool' && board.activeProjects.length > 1) || board.types.length > 0}
      <ProjectFilterBar />
    {/if}
    <div class="view" id={BOARD_VIEW_PANEL_ID} role="tabpanel" aria-label={view === 'kanban' ? 'Tableau' : 'Chronologie'}>
      {#if view === 'kanban'}
        <KanbanBoard onopencard={openCard} oncreatecard={createCard} />
      {:else}
        <Timeline onopencard={openCard} />
      {/if}
    </div>
    <CardModal bind:cardId={modalCardId} bind:draftState bind:open={modalOpen} />
  {:else if failure}
    <div class="state" role="alert">
      <div class="state-card">
        <div class="state-icon" class:error={failure.retry} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.4" fill="none" />
            <path d="M8 4.75v3.75M8 10.9v.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </div>
        <h1>{failure.title}</h1>
        <p>{failure.text}</p>
        <div class="state-actions">
          <a class="btn" href="/pools">Retour aux pools</a>
          {#if failure.retry}
            <button class="btn btn-primary" type="button" onclick={() => board.load({ kind, id })}>Réessayer</button>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="state loading" role="status" aria-label="Chargement">
      <span class="delayed"><Spinner size={16} /></span>
    </div>
  {/if}
</div>

<style>
  .board-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .state {
    display: grid;
    place-items: center;
    flex: 1;
    padding: 24px;
  }

  /* Même échelle que les états vides / d'erreur de la liste des pools et de la chronologie. */
  .state-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 400px;
    text-align: center;
  }

  .state-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-bottom: 16px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-muted);
  }

  /* Chargement impossible (réseau, serveur) : ton « erreur », comme sur la liste des pools.
     Accès refusé / introuvable : ton neutre, ce n'est pas une panne. */
  .state-icon.error {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .state-card h1 {
    font-size: 15px;
  }

  .state-card p {
    margin: 6px 0 20px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .state-actions {
    display: flex;
    gap: 8px;
  }

  /* Spinner rapide, affiché seulement si le chargement dure (pas de flash sur un chargement court). */
  .loading {
    color: var(--text-muted);
  }

  .delayed {
    display: inline-flex;
    opacity: 0;
    animation: appear 150ms ease 250ms forwards;
  }

  @keyframes appear {
    to {
      opacity: 1;
    }
  }
</style>
