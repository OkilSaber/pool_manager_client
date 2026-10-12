<!--
  Détail d'une carte (une seule instance par page, partagée par le Kanban et la Chronologie).

  Consultation / édition — enregistrement automatique : textes à la sortie du champ (titre aussi sur Entrée),
  listes, priorité et date immédiatement. Échap dans un champ modifié annule la saisie.

  Création (`draftState` renseigné, `cardId` nul) : mêmes champs, gardés en brouillon. Entrée dans le titre ou
  « Créer la carte » crée la carte, puis la modale passe en édition sur elle (assignés compris). Fermer un brouillon
  vide n'enregistre rien ; fermer avec un titre crée la carte (aucune saisie perdue).
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import CardTypeIcon from '$lib/components/CardTypeIcon.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import { computeSchedule, formatLong, toDay } from '$lib/dates';
  import { PRIORITIES, priority } from '$lib/priority';
  import { board, positionBetween } from '$lib/stores/board.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Card } from '$lib/types/Card';
  import type { CreateCard } from '$lib/types/CreateCard';
  import type { UpdateCard } from '$lib/types/UpdateCard';
  import { lastProject, rememberProject } from '$lib/components/projects/project';
  import AssigneeEditor from './AssigneeEditor.svelte';
  import TypeSelect from './TypeSelect.svelte';
  import { formatDayRange } from '$lib/components/timeline/timeline';
  import { autosize } from './autosize';
  import { fmtCreated, fmtWorkingDays, parseEstimate } from '$lib/format';
  import { tooltip } from '$lib/tooltip';

  let {
    cardId = $bindable(null),
    draftState = $bindable(null),
    open = $bindable(false)
  }: {
    /** Carte affichée ; passe à la carte créée à la fin d'une création. */
    cardId?: number | null;
    /** Colonne d'une carte en cours de création (avec `cardId` nul) ; remis à null une fois la carte créée. */
    draftState?: number | null;
    open?: boolean;
  } = $props();

  const uid = $props.id();

  const DEFAULT_PRIORITY = 2;

  /** Mode création : aucune carte encore, une colonne cible. */
  const creating = $derived(cardId == null && draftState != null);
  const inPool = $derived(board.kind === 'pool');

  // La carte affichée reste celle d'avant pendant l'animation de fermeture (ex. juste après suppression).
  const live = $derived(cardId != null ? board.card(cardId) : undefined);
  let last = $state.raw<Card | undefined>();
  $effect.pre(() => {
    if (live) last = live;
  });
  const card = $derived(live ?? (last && last.id === cardId ? last : undefined));

  // Carte disparue (supprimée ailleurs, tableau rechargé) : on ferme.
  $effect(() => {
    if (open && cardId != null && board.detail && !live) open = false;
  });

  // ---------- Brouillons des champs texte ----------

  type Field = 'title' | 'description' | 'estimate';
  let focused = $state<Field | null>(null);
  let confirming = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let title = $state('');
  let description = $state('');
  let estimate = $state('');

  // Brouillon de création : propriétés sans champ texte.
  let draftPriority = $state(DEFAULT_PRIORITY);
  let draftStart = $state('');
  let draftProject = $state<number | null>(null);
  let draftType = $state<number | null>(null);
  /** Création en cours (requête partie). */
  let busy = $state(false);

  // Virgule décimale à l'affichage ; parseEstimate accepte « 2,5 » comme « 2.5 ».
  const estimateText = (c: Card) => (c.estimate_days == null ? '' : String(c.estimate_days).replace('.', ','));
  const cleanTitle = (s: string) => s.trim().replace(/\s+/g, ' ');

  // Nouvelle carte affichée : aucun champ en cours d'édition, pas de confirmation en attente.
  let shownId: number | null = null;
  $effect.pre(() => {
    if (cardId === shownId) return;
    shownId = cardId;
    focused = null;
    confirming = false;
  });

  $effect.pre(() => {
    const c = card;
    const f = focused;
    if (!c) return;
    if (f !== 'title') title = c.title;
    if (f !== 'description') description = c.description;
    if (f !== 'estimate') estimate = estimateText(c);
  });

  // ---------- Création : brouillon neuf à chaque ouverture ----------

  /** Projet proposé : celui du tableau (vue projet), sinon l'unique projet filtré, le dernier utilisé, le premier actif. */
  function defaultProject(): number | null {
    if (board.kind === 'project') return board.project?.id ?? null;
    const active = board.activeProjects.map((p) => p.id);
    const filtered = board.projectFilter.filter((id) => active.includes(id));
    if (filtered.length === 1) return filtered[0];
    const remembered = board.pool ? lastProject(board.pool.id) : null;
    const pool = filtered.length ? filtered : active;
    if (remembered != null && pool.includes(remembered)) return remembered;
    return pool[0] ?? null;
  }

  /** Type proposé : l'unique type filtré, s'il y en a un (la carte créée reste alors visible). */
  function defaultType(): number | null {
    const known = board.typeFilter.filter((id) => board.type(id) != null);
    return board.typeFilter.length === 1 && known.length === 1 ? known[0] : null;
  }

  let wasOpen = false;
  $effect.pre(() => {
    const o = open;
    if (o === wasOpen) return;
    wasOpen = o;
    if (!o || !untrack(() => creating)) return;
    untrack(() => {
      title = '';
      description = '';
      estimate = '';
      draftPriority = DEFAULT_PRIORITY;
      draftStart = '';
      draftProject = defaultProject();
      draftType = defaultType();
      focused = null;
      busy = false;
    });
  });

  /** Projet de la carte à créer (implicite en vue projet). */
  const targetProject = $derived(board.kind === 'project' ? (board.project?.id ?? null) : draftProject);
  const canCreate = $derived(creating && cleanTitle(title).length > 0 && targetProject != null && !busy);

  // ---------- Indicateur « Enregistré » ----------

  let saved = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  function flashSaved() {
    saved = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved = false), 1400);
  }

  /** PATCH en cours : une suppression les attend (sinon une réponse tardive réinsère la carte supprimée dans le store). */
  const inflight = new Set<Promise<boolean>>();

  async function patch(p: UpdateCard) {
    if (!card) return;
    const req = board.updateCard(card.id, p);
    inflight.add(req);
    try {
      if (await req) flashSaved();
    } finally {
      inflight.delete(req);
    }
  }

  // ---------- Création ----------

  let titleInput = $state<HTMLTextAreaElement>();
  let descInput = $state<HTMLTextAreaElement>();

  /**
   * Crée la carte depuis le brouillon. `stay` : la modale reste ouverte et passe en édition sur la carte créée
   * (Entrée, bouton) ; sinon (fermeture) la carte est simplement créée.
   */
  async function create(stay: boolean) {
    const projectId = targetProject;
    const stateId = draftState;
    const t = cleanTitle(title);
    if (!creating || busy || !t || projectId == null || stateId == null) return;
    const input: CreateCard = { state_id: stateId, title: t, priority: draftPriority };
    if (description.trim()) input.description = description;
    if (draftType != null && board.type(draftType)) input.type_id = draftType;
    const est = parseEstimate(estimate);
    if (typeof est === 'number') input.estimate_days = est;
    if (draftStart && plausible(draftStart)) input.start_date = draftStart;
    if (board.kind === 'pool' && board.pool) rememberProject(board.pool.id, projectId);

    busy = true;
    const created = await board.createCard(projectId, input);
    busy = false;
    if (!created) return; // toast affiché par le store ; le brouillon reste en place

    // Modifications faites pendant la requête : enregistrées tout de suite sur la carte créée.
    const extra: UpdateCard = {};
    const t2 = cleanTitle(title);
    if (t2 && t2 !== created.title) extra.title = t2;
    if (description !== created.description && (description.trim() || created.description)) extra.description = description;
    const est2 = parseEstimate(estimate);
    if (est2 !== undefined && est2 !== created.estimate_days) extra.estimate_days = est2;
    if (draftPriority !== created.priority) extra.priority = draftPriority;
    const type2 = draftType != null && board.type(draftType) ? draftType : null;
    if (type2 !== created.type_id) extra.type_id = type2;
    const start2 = draftStart && plausible(draftStart) ? draftStart : null;
    if (start2 !== created.start_date) extra.start_date = start2;
    if (Object.keys(extra).length) void board.updateCard(created.id, extra);

    if (!stay || !open || cardId != null || draftState !== stateId) return;
    // Bascule en édition sans réinitialiser les champs en cours de saisie.
    const fromTitle = document.activeElement === titleInput;
    shownId = created.id;
    cardId = created.id;
    draftState = null;
    flashSaved();
    await tick();
    // Titre validé par Entrée, ou bouton « Créer » remplacé par le pied d'édition : on enchaîne sur la description.
    const lost = !document.activeElement || document.activeElement === document.body;
    if (fromTitle || lost) descInput?.focus();
  }

  // ---------- Enregistrements ----------

  function saveTitle() {
    if (!card) return;
    const v = cleanTitle(title);
    if (!v) {
      title = card.title; // titre obligatoire : on revient à la valeur enregistrée
      return;
    }
    if (v !== card.title) patch({ title: v });
  }

  function saveDescription() {
    if (card && description !== card.description) patch({ description });
  }

  function saveEstimate() {
    if (!card) return;
    const v = parseEstimate(estimate);
    if (v === undefined) {
      estimate = estimateText(card);
      return;
    }
    if (v !== card.estimate_days) patch({ estimate_days: v });
  }

  function flush() {
    saveTitle();
    saveDescription();
    saveEstimate();
  }

  // Démontage pendant une saisie (navigation, tableau rechargé) : aucun blur ni fermeture ne viendra enregistrer.
  $effect(() => () => {
    if (focused) flush();
  });

  function setState(stateId: number) {
    if (creating) {
      draftState = stateId;
      return;
    }
    if (!card || stateId === card.state_id) return;
    // En fin de colonne cible, calculé ici pour que l'affichage optimiste soit déjà à la bonne place.
    const tail = board.cardsInState(stateId).at(-1);
    patch({ state_id: stateId, position: positionBetween(tail?.position, undefined) });
  }

  function setProject(projectId: number) {
    if (creating) {
      draftProject = projectId;
      return;
    }
    if (card && projectId !== card.project_id) patch({ project_id: projectId });
  }

  function setType(typeId: number | null) {
    if (creating) draftType = typeId;
    else if (card && typeId !== card.type_id) patch({ type_id: typeId });
  }

  function setPriority(value: number) {
    if (creating) draftPriority = value;
    else if (card && value !== card.priority) patch({ priority: value });
  }

  /** Les années partielles pendant la frappe (0002…) ne sont pas enregistrées. */
  function plausible(date: string): boolean {
    const y = Number(date.slice(0, 4));
    return toDay(date) != null && y >= 1970 && y <= 2200;
  }

  let startInput = $state<HTMLInputElement>();

  /** Le bouton « Effacer » disparaît avec la date : le focus passe au champ au lieu de tomber sur <body>. */
  function clearStart() {
    setStart('');
    startInput?.focus();
  }

  function setStart(value: string) {
    if (value && !plausible(value)) return;
    if (creating) {
      draftStart = value;
      return;
    }
    if (!card) return;
    const next = value || null;
    if (next !== card.start_date) patch({ start_date: next });
  }

  // ---------- Clavier ----------

  function revertOnEscape(e: KeyboardEvent, field: Field) {
    if (e.key !== 'Escape' || !card) return;
    const changed =
      (field === 'title' && title !== card.title) ||
      (field === 'description' && description !== card.description) ||
      (field === 'estimate' && estimate !== estimateText(card));
    if (!changed) return; // rien à annuler : Échap ferme la modale
    e.preventDefault();
    e.stopPropagation();
    focused = null; // le brouillon se réaligne sur la carte
    (e.currentTarget as HTMLElement).blur();
  }

  function ontitlekey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (creating) void create(true);
      else (e.currentTarget as HTMLElement).blur(); // le blur enregistre
    } else revertOnEscape(e, 'title');
  }

  function onestimatekey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else revertOnEscape(e, 'estimate');
  }

  function onblur(field: Field) {
    if (focused !== field) return; // annulé par Échap
    if (field === 'title') saveTitle();
    else if (field === 'description') saveDescription();
    else if (field === 'estimate') saveEstimate();
    focused = null;
  }

  function onprioritykey(e: KeyboardEvent) {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(4, vPriority + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, vPriority - 1);
    if (next < 0) return;
    e.preventDefault();
    setPriority(next);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }

  // ---------- Suppression (confirmation en deux temps) ----------

  async function remove() {
    if (!card) return;
    if (!confirming) {
      confirming = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = false), 3000);
      return;
    }
    clearTimeout(confirmTimer);
    confirming = false;
    const id = card.id;
    open = false;
    await Promise.allSettled([...inflight]);
    if (await board.deleteCard(id)) toast.success('Carte supprimée');
  }

  function onclose() {
    // Brouillon avec un titre : créé à la fermeture (rien n'est perdu) ; brouillon vide : rien.
    if (creating) void create(false);
    else flush();
    focused = null;
    clearTimeout(confirmTimer);
    confirming = false;
  }

  // ---------- Dérivés d'affichage ----------

  const vState = $derived(card ? card.state_id : draftState);
  const vPriority = $derived(card ? card.priority : draftPriority);
  const vType = $derived(card ? card.type_id : draftType);
  const cardType = $derived(board.type(vType));
  const vStart = $derived(card ? card.start_date : draftStart || null);
  const vEstimate = $derived.by(() => {
    if (card) return card.estimate_days;
    const v = parseEstimate(estimate);
    return typeof v === 'number' ? v : null;
  });
  /** Planification : celle de la carte, ou un aperçu du brouillon (sans assignés : une personne à 100 %). */
  const schedule = $derived(card ? card.schedule : computeSchedule(vStart, vEstimate));
  /** Plusieurs assignés : chacun peut avoir sa date ; celle de la carte n'est plus qu'une valeur par défaut. */
  const multi = $derived((card?.assignees.length ?? 0) >= 2);
  const spanStart = $derived(schedule ? toDay(schedule.start) : null);

  const column = $derived(vState != null ? board.states.find((s) => s.id === vState) : undefined);
  const project = $derived(card ? board.projectOf(card.project_id) : targetProject != null ? board.projectOf(targetProject) : undefined);
  /** Projets proposés (vue pool) : les actifs, plus celui de la carte s'il ne l'est plus. */
  const projectChoices = $derived(
    project && project.archived ? [...board.activeProjects, project] : board.activeProjects
  );
  const author = $derived(card ? board.member(card.created_by)?.display_name : undefined);
  const end = $derived(schedule ? toDay(schedule.end) : null);
  const shiftedStart = $derived(!multi && schedule && vStart && schedule.start !== vStart ? toDay(schedule.start) : null);
  const missing = $derived.by(() => {
    if (schedule) return '';
    const noStart = !vStart;
    const noEstimate = vEstimate == null;
    if (noStart && noEstimate)
      return creating
        ? 'Ajoutez une date de début et un chiffrage pour planifier la carte.'
        : 'Ajoutez une date de début et un chiffrage pour planifier cette carte.';
    if (noStart) return 'Ajoutez une date de début pour calculer la fin.';
    if (noEstimate) return 'Ajoutez un chiffrage pour calculer la fin.';
    return 'Le chiffrage doit être supérieur à 0.';
  });
</script>

<Modal bind:open title={creating ? 'Nouvelle carte' : 'Détails de la carte'} width={780} {onclose}>
  {#snippet headerExtra()}
    <span class="saved" class:show={saved} aria-hidden={!saved}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      Enregistré
    </span>
  {/snippet}

  {#if card || creating}
    <div class="layout">
      <div class="main">
        {#if project}
          <div class="crumb">
            <span class="project-chip" style:--c={project.color}>
              <span class="dot" aria-hidden="true"></span>
              {project.name}
            </span>
            <span class="key num" class:muted={!card}>
              {#if cardType}<CardTypeIcon icon={cardType.icon} size={12} label="Type : {cardType.name}" />{/if}
              {card ? board.cardKey(card) : `${project.code}-…`}
            </span>
          </div>
        {/if}

        <!-- svelte-ignore a11y_autofocus -->
        <textarea
          bind:this={titleInput}
          class="title-input"
          rows="1"
          maxlength="500"
          aria-label="Titre de la carte"
          placeholder={creating ? 'Titre de la carte' : undefined}
          autofocus={creating}
          bind:value={title}
          onfocus={() => (focused = 'title')}
          onblur={() => onblur('title')}
          onkeydown={ontitlekey}
          {@attach autosize(title, 200)}
        ></textarea>

        <div class="field">
          <label class="label" for="{uid}-desc">Description</label>
          <textarea
            bind:this={descInput}
            id="{uid}-desc"
            class="textarea desc"
            placeholder="Ajoutez du contexte, des liens, des critères d’acceptation…"
            bind:value={description}
            onfocus={() => (focused = 'description')}
            onblur={() => onblur('description')}
            onkeydown={(e) => revertOnEscape(e, 'description')}
            {@attach autosize(description, 360)}
          ></textarea>
        </div>

        {#if card}
          <AssigneeEditor {card} onsaved={flashSaved} />
        {:else}
          <div class="field">
            <span class="label">Assignés</span>
            <p class="assign-later">Vous pourrez assigner la carte une fois créée.</p>
          </div>
        {/if}
      </div>

      <aside class="side" aria-label="Propriétés">
        {#if inPool}
          <div class="field">
            <label class="label" for="{uid}-project">Projet</label>
            {#if projectChoices.length}
              <div class="select-wrap" style:--c={project?.color ?? 'var(--text-subtle)'}>
                <span class="dot" aria-hidden="true"></span>
                <select
                  id="{uid}-project"
                  class="select"
                  value={card ? card.project_id : (draftProject ?? '')}
                  required={creating}
                  onchange={(e) => setProject(Number(e.currentTarget.value))}
                >
                  {#if creating && draftProject == null}
                    <option value="" disabled>Choisir un projet…</option>
                  {/if}
                  {#each projectChoices as p (p.id)}
                    <option value={p.id}>{p.code} · {p.name}</option>
                  {/each}
                </select>
              </div>
              {#if card}
                <span class="sub">Changer de projet renumérote la carte.</span>
              {/if}
            {:else}
              <p class="end-note">Aucun projet actif dans ce pool : créez-en un depuis « Projets ».</p>
            {/if}
          </div>
        {/if}

        <div class="field">
          <label class="label" for="{uid}-state">État</label>
          <div class="select-wrap" style:--c={column?.color ?? 'var(--text-subtle)'}>
            <span class="dot" aria-hidden="true"></span>
            <select id="{uid}-state" class="select" value={vState} onchange={(e) => setState(Number(e.currentTarget.value))}>
              {#each board.states as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>
        </div>

        {#if board.types.length}
          <div class="field">
            <span class="label" id="{uid}-type">Type</span>
            <TypeSelect value={vType} types={board.types} labelledby="{uid}-type" onchange={setType} />
          </div>
        {/if}

        <div class="field">
          <span class="label" id="{uid}-prio">Priorité</span>
          <div class="prio" role="radiogroup" aria-labelledby="{uid}-prio" tabindex="-1" onkeydown={onprioritykey}>
            {#each PRIORITIES as p (p.value)}
              {@const active = vPriority === p.value}
              <button
                type="button"
                role="radio"
                class="prio-btn num"
                class:active
                aria-checked={active}
                aria-label="{p.label} · {p.name}"
                tabindex={active ? 0 : -1}
                style:--c={p.color}
                onclick={() => setPriority(p.value)}
                {@attach tooltip(p.name)}
              >
                {p.label}
              </button>
            {/each}
          </div>
          <span class="sub">{priority(vPriority).name}</span>
        </div>

        <div class="field">
          <label class="label" for="{uid}-estimate">Chiffrage</label>
          <div class="suffixed">
            <!--
              Champ texte (et non type="number") : une saisie « 2,5 » ou partielle y donne value = "" sur un champ
              numérique, ce qui effaçait le chiffrage au blur. parseEstimate accepte virgule et point.
            -->
            <input
              id="{uid}-estimate"
              class="input num"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              spellcheck="false"
              placeholder="—"
              aria-describedby="{uid}-estimate-unit"
              value={estimate}
              oninput={(e) => (estimate = e.currentTarget.value)}
              onfocus={() => (focused = 'estimate')}
              onblur={() => onblur('estimate')}
              onkeydown={onestimatekey}
            />
            <span class="suffix" id="{uid}-estimate-unit" aria-hidden="true">j/h</span>
          </div>
        </div>

        <div class="field">
          <label class="label" for="{uid}-start">{multi ? 'Date de début par défaut' : 'Date de début'}</label>
          <div class="date-row">
            <input
              bind:this={startInput}
              id="{uid}-start"
              class="input num"
              type="date"
              aria-describedby={multi ? `${uid}-start-hint` : undefined}
              value={vStart ?? ''}
              onchange={(e) => setStart(e.currentTarget.value)}
              onblur={(e) => {
                // Saisie incomplète ou invraisemblable : on réaffiche la date enregistrée.
                if (e.currentTarget.value && !plausible(e.currentTarget.value)) e.currentTarget.value = vStart ?? '';
              }}
            />
            {#if vStart}
              <button
                class="btn btn-ghost btn-sm btn-icon"
                type="button"
                aria-label="Effacer la date de début"
                onclick={clearStart}
                {@attach tooltip('Effacer la date')}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </button>
            {/if}
          </div>
          {#if multi}
            <span class="sub" id="{uid}-start-hint">Chaque assigné peut avoir sa propre date</span>
          {/if}
        </div>

        <div class="end" class:empty={!schedule}>
          <span class="label">Fin prévue</span>
          {#if schedule && end != null}
            {#if multi && spanStart != null && spanStart !== end}
              <p class="end-date num">
                <strong>{formatDayRange(spanStart, end)}</strong>
              </p>
              <p class="end-note num">{fmtWorkingDays(schedule.working_days)}, du premier début à la dernière fin</p>
            {:else}
              <p class="end-date num">
                <strong>{formatLong(end)}</strong>
                <span class="muted">· {fmtWorkingDays(schedule.working_days)}</span>
              </p>
            {/if}
            {#if shiftedStart != null}
              <p class="end-note">Début décalé au {formatLong(shiftedStart)} (week-end).</p>
            {/if}
          {:else}
            <p class="end-note">{missing}</p>
          {/if}
        </div>
      </aside>
    </div>
  {/if}

  {#snippet footer()}
    {#if card}
      <span class="created">
        Créée le {fmtCreated(card.created_at)}{#if author}&nbsp;par {author}{/if}
      </span>
      <button class="btn btn-sm delete" class:confirm={confirming} type="button" onclick={remove}>
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" />
        </svg>
        {confirming ? 'Confirmer la suppression' : 'Supprimer'}
      </button>
    {:else if creating}
      <span class="created">
        <span class="kbd" aria-hidden="true">↵</span> dans le titre pour créer
      </span>
      <button class="btn btn-sm" type="button" onclick={() => (open = false)}>Fermer</button>
      <button
        class="btn btn-sm btn-primary"
        type="button"
        disabled={!canCreate && !busy}
        aria-busy={busy}
        onclick={() => create(true)}
      >
        <BusyLabel {busy}>Créer la carte</BusyLabel>
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 232px;
    gap: 28px;
    align-items: start;
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-left: 20px;
    border-left: 1px solid var(--border);
  }

  /* ---------- Projet & titre ---------- */

  .crumb {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: -12px;
    font-size: 12.5px;
  }

  .project-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 60%;
    overflow: hidden;
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .project-chip .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--c);
  }

  .key {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .assign-later {
    margin: 0;
    padding: 10px 12px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .title-input::placeholder {
    color: var(--text-subtle);
  }

  .title-input {
    width: calc(100% + 16px);
    margin: 0 -8px;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: -0.01em;
    resize: none;
    overflow: hidden;
    transition:
      border-color var(--dur-hover) ease,
      box-shadow var(--dur-hover) ease;
  }

  .title-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus);
  }

  @media (hover: hover) and (pointer: fine) {
    .title-input:not(:focus):hover {
      border-color: var(--border);
    }
  }

  .desc {
    min-height: 120px;
    resize: none;
  }

  /* ---------- Propriétés ---------- */

  .select-wrap {
    position: relative;
  }

  .select-wrap .dot {
    position: absolute;
    top: 50%;
    left: 11px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--c);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .select-wrap .select {
    padding-left: 26px;
  }

  .prio {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .prio:focus {
    outline: none;
  }

  .prio-btn {
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    /* Seul l'appui est animé : le choix se fait aussi aux flèches, et une action clavier ne s'anime jamais. */
    transition: transform var(--dur-press) var(--ease-out);
  }

  .prio-btn:active {
    transform: scale(0.95);
  }

  .prio-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  /*
   * Texte teinté mélangé à --text : assombri en clair, éclairci en sombre. La couleur brute sur son propre
   * fond teinté tombe vers 2:1 (P2 ambre, P1 orange en clair ; P3 bleu en sombre).
   */
  .prio-btn.active {
    border-color: color-mix(in srgb, var(--c) 35%, transparent);
    background: color-mix(in srgb, var(--c) 16%, var(--surface));
    color: color-mix(in srgb, var(--c) 60%, var(--text));
  }

  @media (hover: hover) and (pointer: fine) {
    .prio-btn:not(.active):hover {
      background: var(--surface-3);
      color: var(--text);
    }
  }

  .sub {
    font-size: 12px;
    color: var(--text-subtle);
  }

  .suffixed {
    position: relative;
  }

  .suffixed .input {
    padding-right: 36px;
  }

  .suffix {
    position: absolute;
    top: 50%;
    right: 10px;
    transform: translateY(-50%);
    font-size: 12px;
    color: var(--text-subtle);
    pointer-events: none;
  }

  .date-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .date-row .input {
    flex: 1;
    min-width: 0;
  }

  .end {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  /* Seul le style de bordure change : pas de saut d'un pixel quand la carte devient planifiable. */
  .end.empty {
    background: transparent;
    border-style: dashed;
    border-color: var(--border);
  }

  .end-date {
    margin: 0;
    font-size: 13.5px;
  }

  .end-date strong {
    font-weight: 600;
  }

  .end-note {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
  }

  /* ---------- En-tête & pied ---------- */

  .saved {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-right: 6px;
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 200ms ease;
  }

  .saved.show {
    opacity: 1;
    transition-duration: 150ms;
  }

  .saved svg {
    color: var(--success);
  }

  .created {
    margin-right: auto;
    font-size: 12px;
    color: var(--text-muted);
  }

  .delete {
    color: var(--danger);
    min-width: 96px;
  }

  .delete.confirm {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }

  @media (hover: hover) and (pointer: fine) {
    .delete:not(.confirm):hover {
      background: var(--danger-soft);
    }
    .delete.confirm:hover {
      background: var(--danger);
    }
  }

  @media (max-width: 720px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      padding-left: 0;
      border-left: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .prio-btn:active {
      transform: none;
    }
  }
</style>
