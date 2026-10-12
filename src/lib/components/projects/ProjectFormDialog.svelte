<!--
  Création ou réglages d'un projet (mode édition dès que `project` est fourni).
  Champs : nom, code (suggéré depuis le nom à la création), couleur, pool ; en édition : archivage
  et suppression (confirmation en deux temps).
  Les appels passent directement par l'API (erreurs affichées dans le formulaire, ex. 409 « code déjà utilisé »),
  puis le tableau ouvert est resynchronisé s'il est concerné.

  Usage : <ProjectFormDialog bind:open project={p} defaultPoolId={poolId} onsaved={(p) => …} />
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import FormError from '$lib/components/shell/FormError.svelte';
  import { errorMessage } from '$lib/errors';
  import { board } from '$lib/stores/board.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Pool } from '$lib/types/Pool';
  import type { Project } from '$lib/types/Project';
  import type { UpdateProject } from '$lib/types/UpdateProject';
  import { CODE_RE, PROJECT_COLORS, nextProjectColor, normalizeCode, suggestCode } from './project';

  let {
    open = $bindable(false),
    project,
    defaultPoolId = null,
    onsaved
  }: {
    open?: boolean;
    /** Projet à modifier ; absent = création. */
    project?: Project;
    /** Pool proposé à la création (null = projet autonome). */
    defaultPoolId?: number | null;
    onsaved?: (p: Project) => void;
  } = $props();

  const uid = $props.id();
  const editing = $derived(project != null);

  let name = $state('');
  let code = $state('');
  /** Code saisi à la main : il ne suit plus le nom. */
  let codeTouched = $state(false);
  let color = $state(PROJECT_COLORS[0].value);
  /** Valeur du <select> : '' = aucun pool. */
  let poolValue = $state('');
  let archived = $state(false);

  let pools = $state<Pool[] | null>(null);
  let poolsError = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let codeConflict = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  // ---------- Ouverture : formulaire réinitialisé, pools chargés ----------

  let wasOpen = false;
  $effect.pre(() => {
    if (open === wasOpen) return;
    wasOpen = open;
    if (!open) return;
    const p = project;
    name = p?.name ?? '';
    code = p?.code ?? '';
    codeTouched = p != null;
    color = p?.color ?? nextProjectColor(board.projects.map((x) => x.color));
    poolValue = String((p ? p.pool_id : defaultPoolId) ?? '');
    archived = p?.archived ?? false;
    error = null;
    codeConflict = false;
    confirmingDelete = false;
    saving = false;
    deleting = false;
    void loadPools();
  });

  async function loadPools() {
    poolsError = false;
    try {
      pools = await api.listPools();
    } catch {
      poolsError = true;
    }
  }

  // Droits (comme le serveur) : renommer, recolorer, archiver = toute personne ayant accès ;
  // rattacher / déplacer = propriétaire du projet ; détacher, supprimer = propriétaire du projet ou du pool.
  const isProjectOwner = $derived(!project || project.owner_id === session.user?.id);
  const isPoolOwner = $derived.by(() => {
    const poolOf = project?.pool_id;
    if (poolOf == null) return false;
    const known = board.pool?.id === poolOf ? board.pool : pools?.find((p) => p.id === poolOf);
    return known?.role === 'owner';
  });
  const canDelete = $derived(isProjectOwner || isPoolOwner);
  const poolLocked = $derived(!isProjectOwner && !isPoolOwner);

  /** Pools proposés ; le pool courant reste listé même si la liste n'est pas (encore) chargée. */
  const poolOptions = $derived.by(() => {
    // Sans être propriétaire du projet, on ne peut que le détacher : seul son pool actuel est proposé.
    const list = isProjectOwner ? [...(pools ?? [])] : (pools ?? []).filter((p) => p.id === project?.pool_id);
    const current = Number(poolValue);
    if (current && !list.some((p) => p.id === current) && board.pool?.id === current) list.push(board.pool);
    return list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  });

  // ---------- Champs ----------

  function oninputname(e: Event & { currentTarget: HTMLInputElement }) {
    name = e.currentTarget.value;
    if (!codeTouched) code = suggestCode(name);
  }

  function oninputcode(e: Event & { currentTarget: HTMLInputElement }) {
    const next = normalizeCode(e.currentTarget.value);
    code = next;
    e.currentTarget.value = next; // caractères refusés retirés tout de suite
    codeTouched = next.length > 0;
    codeConflict = false;
  }

  const poolId = $derived(poolValue ? Number(poolValue) : null);
  const codeValid = $derived(CODE_RE.test(code));
  const canSubmit = $derived(name.trim().length > 0 && codeValid && !saving && !deleting);
  const poolChanged = $derived(editing && project != null && (project.pool_id ?? null) !== poolId);

  // ---------- Enregistrement ----------

  /** Le tableau ouvert affiche-t-il ce projet (ou le pool qu'il quitte / rejoint) ? */
  function boardConcerned(p: { id: number; pool_id: number | null }, previousPool: number | null): boolean {
    if (!board.detail) return false;
    if (board.kind === 'project') return board.project?.id === p.id;
    const open = board.pool?.id;
    return open != null && (open === p.pool_id || open === previousPool);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    saving = true;
    error = null;
    codeConflict = false;
    try {
      let saved: Project;
      const previousPool = project?.pool_id ?? null;
      if (project) {
        const patch: UpdateProject = {};
        const n = name.trim();
        if (n !== project.name) patch.name = n;
        if (code !== project.code) patch.code = code;
        if (color !== project.color.toLowerCase()) patch.color = color;
        if (archived !== project.archived) patch.archived = archived;
        if (poolChanged) patch.pool_id = poolId;
        saved = Object.keys(patch).length ? await api.updateProject(project.id, patch) : project;
      } else {
        saved = await api.createProject({ name: name.trim(), code, color, pool_id: poolId ?? undefined });
      }
      if (boardConcerned(saved, previousPool)) await board.refresh().catch(() => {});
      saving = false;
      open = false;
      if (!project) toast.success(`Projet ${saved.code} créé`);
      onsaved?.(saved);
    } catch (err) {
      saving = false;
      codeConflict = err instanceof ApiError && err.status === 409;
      error = codeConflict ? `Le code ${code} est déjà utilisé par un autre projet.` : errorMessage(err);
    }
  }

  // ---------- Suppression ----------

  async function remove() {
    if (!project || deleting) return;
    if (!confirmingDelete) {
      confirmingDelete = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmingDelete = false), 4000);
      return;
    }
    clearTimeout(confirmTimer);
    const target = project;
    deleting = true;
    error = null;
    try {
      await api.deleteProject(target.id);
    } catch (err) {
      deleting = false;
      confirmingDelete = false;
      error = errorMessage(err);
      return;
    }
    deleting = false;
    confirmingDelete = false;
    open = false;
    toast.success(`Projet ${target.code} supprimé`);
    if (board.kind === 'project' && board.project?.id === target.id) {
      // Le tableau ouvert vient de disparaître : retour à son pool, sinon à l'accueil.
      goto(target.pool_id != null ? `/pools/${target.pool_id}` : '/pools');
    } else if (board.kind === 'pool' && board.pool?.id === target.pool_id) {
      await board.refresh().catch(() => {});
    }
  }

  function onclose() {
    clearTimeout(confirmTimer);
    confirmingDelete = false;
  }
</script>

<Modal bind:open title={editing ? 'Réglages du projet' : 'Nouveau projet'} width={480} {onclose}>
  <form id="{uid}-form" class="form" onsubmit={submit} novalidate>
    <div class="field">
      <label class="label" for="{uid}-name">Nom</label>
      <input
        id="{uid}-name"
        class="input"
        value={name}
        oninput={oninputname}
        maxlength="80"
        autocomplete="off"
        placeholder="Site vitrine"
        {@attach (n) => {
          // Focus après l'ouverture native du <dialog> (qui place sinon le focus sur le premier bouton).
          const id = requestAnimationFrame(() => {
            n.focus();
            if (editing) n.select();
          });
          return () => cancelAnimationFrame(id);
        }}
      />
    </div>

    <div class="field">
      <label class="label" for="{uid}-code">Code</label>
      <div class="code-row">
        <input
          id="{uid}-code"
          class="input code num"
          value={code}
          oninput={oninputcode}
          maxlength="6"
          autocomplete="off"
          spellcheck="false"
          placeholder="SITE"
          aria-invalid={codeConflict || (code.length > 0 && !codeValid)}
          aria-describedby="{uid}-code-hint"
        />
        <span class="preview num" aria-hidden="true">
          <span class="dot" style:background={color}></span>{code || 'CODE'}-12
        </span>
      </div>
      <span class="hint" id="{uid}-code-hint" class:bad={code.length > 0 && !codeValid}>
        2 à 6 lettres ou chiffres, commençant par une lettre. Les cartes sont numérotées {code || 'CODE'}-1, {code || 'CODE'}-2…
      </span>
    </div>

    <div class="field">
      <span class="label" id="{uid}-color">Couleur</span>
      <div class="swatches" role="radiogroup" aria-labelledby="{uid}-color">
        {#each PROJECT_COLORS as c (c.value)}
          {@const active = color === c.value}
          <button
            type="button"
            class="swatch"
            role="radio"
            aria-checked={active}
            aria-label={c.name}
            title={c.name}
            tabindex={active || (!PROJECT_COLORS.some((x) => x.value === color) && c === PROJECT_COLORS[0]) ? 0 : -1}
            style:--c={c.value}
            onclick={() => (color = c.value)}
            onkeydown={(e) => {
              const i = PROJECT_COLORS.indexOf(c);
              let next = -1;
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % PROJECT_COLORS.length;
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + PROJECT_COLORS.length) % PROJECT_COLORS.length;
              if (next < 0) return;
              e.preventDefault();
              color = PROJECT_COLORS[next].value;
              ((e.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
          ></button>
        {/each}
      </div>
    </div>

    <div class="field">
      <label class="label" for="{uid}-pool">Pool</label>
      <select id="{uid}-pool" class="select" bind:value={poolValue} disabled={poolLocked}>
        <option value="">Aucun (projet autonome)</option>
        {#each poolOptions as p (p.id)}
          <option value={String(p.id)}>{p.name}</option>
        {/each}
      </select>
      {#if poolsError}
        <span class="hint bad">Liste des pools indisponible. <button class="link" type="button" onclick={loadPools}>Réessayer</button></span>
      {:else if poolLocked}
        <span class="hint">Seul le propriétaire du projet (ou du pool) peut le changer de pool.</span>
      {:else if poolChanged}
        <p class="warning" role="status">
          {poolId == null ? 'Le projet quittera son pool.' : 'Le projet changera de pool.'}
          Ses cartes iront dans les colonnes de même nom, et les assignés qui n’ont plus accès en seront retirés.
        </p>
      {:else}
        <span class="hint">
          {poolId == null ? 'Visible de vous seul, avec ses propres colonnes.' : 'Partagé avec les membres du pool, dans ses colonnes.'}
        </span>
      {/if}
    </div>

    {#if editing}
      <label class="switch-row">
        <input type="checkbox" class="switch" bind:checked={archived} />
        <span class="switch-text">
          <span class="switch-title">Projet archivé</span>
          <span class="hint">Masqué du Kanban et de la chronologie du pool ; ses cartes sont conservées.</span>
        </span>
      </label>
    {/if}

    <FormError message={error} />
  </form>

  {#snippet footer()}
    {#if editing && canDelete}
      <button
        class="btn btn-sm delete"
        class:btn-destructive={confirmingDelete}
        class:btn-danger={!confirmingDelete}
        type="button"
        aria-busy={deleting}
        onclick={remove}
      >
        <BusyLabel busy={deleting}>{confirmingDelete ? 'Confirmer : supprimer ses cartes aussi' : 'Supprimer le projet'}</BusyLabel>
      </button>
    {/if}
    <button class="btn" type="button" onclick={() => (open = false)}>Annuler</button>
    <button class="btn btn-primary" type="submit" form="{uid}-form" disabled={!canSubmit && !saving} aria-busy={saving}>
      <BusyLabel busy={saving}>{editing ? 'Enregistrer' : 'Créer le projet'}</BusyLabel>
    </button>
  {/snippet}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .hint {
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .hint.bad {
    color: var(--danger);
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .code {
    width: 120px;
    flex: none;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .code[aria-invalid='true'] {
    border-color: var(--danger);
  }

  .preview {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 999px;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--c);
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
    transition: transform var(--dur-press) var(--ease-out);
  }

  .swatch:active {
    transform: scale(0.92);
  }

  .swatch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Choisie : anneau à la couleur du fond puis à la couleur du projet. */
  .swatch[aria-checked='true'] {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--c);
  }

  .warning {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warning) 12%, var(--surface));
    color: color-mix(in srgb, var(--warning) 45%, var(--text));
    font-size: 12.5px;
    line-height: 1.45;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  .switch-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }

  .switch-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .switch-title {
    font-size: 13px;
    font-weight: 500;
  }

  .switch {
    appearance: none;
    position: relative;
    flex: none;
    width: 30px;
    height: 18px;
    margin: 1px 0 0;
    border-radius: 999px;
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--border-strong);
    cursor: pointer;
    transition: background-color var(--dur-hover) ease;
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: #fff;
    box-shadow: var(--shadow-sm);
    transition: transform 160ms var(--ease-out);
  }

  .switch:checked {
    background: var(--accent);
    box-shadow: none;
  }

  .switch:checked::after {
    transform: translateX(12px);
  }

  .switch:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  .delete {
    margin-right: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .swatch:active {
      transform: none;
    }
    .switch::after {
      transition: none;
    }
  }
</style>
