<!--
  Projets du pool ouvert : liste (archivés estompés), ouverture du tableau d'un projet, réglages,
  création d'un projet dans le pool et rattachement d'un de mes projets autonomes.
-->
<script lang="ts">
  import { api } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import FormError from '$lib/components/shell/FormError.svelte';
  import { errorMessage } from '$lib/errors';
  import { board } from '$lib/stores/board.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Project } from '$lib/types/Project';
  import { tooltip } from '$lib/tooltip';
  import ProjectFormDialog from './ProjectFormDialog.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const uid = $props.id();

  const counts = $derived.by(() => {
    const m = new Map<number, number>();
    for (const c of board.cards) m.set(c.project_id, (m.get(c.project_id) ?? 0) + 1);
    return m;
  });

  const projects = $derived(
    [...board.projects].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'fr'))
  );

  // ---------- Création / réglages ----------

  let formOpen = $state(false);
  let editing = $state<Project | undefined>();

  function create() {
    editing = undefined;
    formOpen = true;
  }

  function settings(p: Project) {
    editing = p;
    formOpen = true;
  }

  // ---------- Rattachement ----------

  let attachOpen = $state(false);
  let standalone = $state<Project[] | null>(null);
  let attachValue = $state('');
  let attaching = $state(false);
  let attachError = $state<string | null>(null);

  async function startAttach() {
    attachOpen = true;
    attachError = null;
    attachValue = '';
    standalone = null;
    try {
      const mine = await api.listProjects();
      standalone = mine.filter((p) => p.pool_id === null).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      if (standalone.length) attachValue = String(standalone[0].id);
    } catch (e) {
      attachError = errorMessage(e);
      standalone = [];
    }
  }

  async function attach(e: SubmitEvent) {
    e.preventDefault();
    const pool = board.pool;
    const id = Number(attachValue);
    if (!pool || !id || attaching) return;
    attaching = true;
    attachError = null;
    try {
      const p = await api.updateProject(id, { pool_id: pool.id });
      await board.refresh().catch(() => {});
      attachOpen = false;
      toast.success(`${p.name} rattaché au pool`);
    } catch (err) {
      attachError = errorMessage(err);
    } finally {
      attaching = false;
    }
  }

  function onclose() {
    attachOpen = false;
  }
</script>

<Modal bind:open title="Projets du pool" width={560} {onclose}>
  {#if projects.length === 0}
    <div class="empty">
      <p>Ce pool n’a pas encore de projet. Les cartes appartiennent à un projet : créez-en un pour commencer.</p>
    </div>
  {:else}
    <ul class="list" aria-label="Projets">
      {#each projects as p (p.id)}
        {@const n = counts.get(p.id) ?? 0}
        <li class="row" class:archived={p.archived}>
          <span class="dot" style:background={p.color} aria-hidden="true"></span>
          <span class="code num">{p.code}</span>
          <a class="name" href="/projects/{p.id}" onclick={() => (open = false)} title={p.name}>{p.name}</a>
          {#if p.archived}
            <span class="tag">Archivé</span>
          {:else}
            <span class="count num">{n} carte{n > 1 ? 's' : ''}</span>
          {/if}
          <button
            class="btn btn-ghost btn-sm btn-icon"
            type="button"
            aria-label="Réglages du projet {p.name}"
            onclick={() => settings(p)}
            {@attach tooltip('Réglages')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              <circle cx="11" cy="4.5" r="1.5" stroke="currentColor" stroke-width="1.4" fill="none" />
              <circle cx="5" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.4" fill="none" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if attachOpen}
    <form class="attach" onsubmit={attach}>
      <label class="label" for="{uid}-attach">Rattacher un de vos projets autonomes</label>
      {#if standalone === null}
        <p class="hint">Chargement…</p>
      {:else if standalone.length === 0 && !attachError}
        <p class="hint">Vous n’avez aucun projet autonome à rattacher.</p>
      {:else if standalone.length}
        <div class="attach-row">
          <select id="{uid}-attach" class="select" bind:value={attachValue}>
            {#each standalone as p (p.id)}
              <option value={String(p.id)}>{p.code} · {p.name}</option>
            {/each}
          </select>
          <button class="btn btn-primary" type="submit" aria-busy={attaching} disabled={!attachValue}>
            <BusyLabel busy={attaching}>Rattacher</BusyLabel>
          </button>
        </div>
        <p class="hint">Ses cartes iront dans les colonnes de même nom du pool.</p>
      {/if}
      <FormError message={attachError} />
    </form>
  {/if}

  {#snippet footer()}
    {#if !attachOpen}
      <button class="btn btn-sm btn-ghost attach-btn" type="button" onclick={startAttach}>Rattacher un projet</button>
    {/if}
    <button class="btn btn-sm" type="button" onclick={() => (open = false)}>Fermer</button>
    <button class="btn btn-sm btn-primary" type="button" onclick={create}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      Nouveau projet
    </button>
  {/snippet}
</Modal>

<ProjectFormDialog bind:open={formOpen} project={editing} defaultPoolId={board.pool?.id ?? null} />

<style>
  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }

  .row + .row {
    border-top: 1px solid var(--border);
  }

  .row.archived > :not(.btn) {
    opacity: 0.55;
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 999px;
  }

  .code {
    flex: none;
    min-width: 52px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-radius: 4px;
  }

  @media (hover: hover) and (pointer: fine) {
    .name:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }

  .count,
  .tag {
    flex: none;
    font-size: 12px;
    color: var(--text-muted);
  }

  .tag {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    font-weight: 500;
  }

  .empty p {
    margin: 0;
    padding: 12px 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .attach {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .attach-row {
    display: flex;
    gap: 8px;
  }

  .attach-row .btn {
    flex: none;
    height: 34px;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .attach-btn {
    margin-right: auto;
  }
</style>
