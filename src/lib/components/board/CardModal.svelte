<!--
  Détail d'une carte (une seule instance par page, partagée par le Kanban et la Chronologie).
  Enregistrement automatique : textes à la sortie du champ (titre aussi sur Entrée),
  listes, priorité et date immédiatement. Échap dans un champ modifié annule la saisie.
-->
<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { formatLong, toDay } from '$lib/dates';
  import { PRIORITIES, priority } from '$lib/priority';
  import { board, positionBetween } from '$lib/stores/board.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Card } from '$lib/types/Card';
  import type { UpdateCard } from '$lib/types/UpdateCard';
  import AssigneeEditor from './AssigneeEditor.svelte';
  import { autosize } from './autosize';
  import { fmtCreated, fmtWorkingDays, parseEstimate } from '$lib/format';
  import { tooltip } from '$lib/tooltip';

  let { cardId, open = $bindable(false) }: { cardId: number | null; open?: boolean } = $props();

  const uid = $props.id();

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

  // Virgule décimale à l'affichage ; parseEstimate accepte « 2,5 » comme « 2.5 ».
  const estimateText = (c: Card) => (c.estimate_days == null ? '' : String(c.estimate_days).replace('.', ','));

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

  // ---------- Enregistrements ----------

  function saveTitle() {
    if (!card) return;
    const v = title.trim().replace(/\s+/g, ' ');
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
    if (!card || stateId === card.state_id) return;
    // En fin de colonne cible, calculé ici pour que l'affichage optimiste soit déjà à la bonne place.
    const tail = board.cardsInState(stateId).at(-1);
    patch({ state_id: stateId, position: positionBetween(tail?.position, undefined) });
  }

  function setPriority(value: number) {
    if (card && value !== card.priority) patch({ priority: value });
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
    if (!card) return;
    const next = value || null;
    if (next !== null && !plausible(next)) return;
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
      (e.currentTarget as HTMLElement).blur(); // le blur enregistre
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
    if (!card) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(4, card.priority + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, card.priority - 1);
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
    flush();
    focused = null;
    clearTimeout(confirmTimer);
    confirming = false;
  }

  // ---------- Dérivés d'affichage ----------

  const column = $derived(card ? board.states.find((s) => s.id === card.state_id) : undefined);
  const author = $derived(card ? board.member(card.created_by)?.display_name : undefined);
  const end = $derived(card?.schedule ? toDay(card.schedule.end) : null);
  const shiftedStart = $derived(
    card?.schedule && card.start_date && card.schedule.start !== card.start_date ? toDay(card.schedule.start) : null
  );
  const missing = $derived.by(() => {
    if (!card || card.schedule) return '';
    const noStart = !card.start_date;
    const noEstimate = card.estimate_days == null;
    if (noStart && noEstimate) return 'Ajoutez une date de début et un chiffrage pour planifier cette carte.';
    if (noStart) return 'Ajoutez une date de début pour calculer la fin.';
    if (noEstimate) return 'Ajoutez un chiffrage pour calculer la fin.';
    return 'Le chiffrage doit être supérieur à 0.';
  });
</script>

<Modal bind:open title="Détails de la carte" width={780} {onclose}>
  {#snippet headerExtra()}
    <span class="saved" class:show={saved} aria-hidden={!saved}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      Enregistré
    </span>
  {/snippet}

  {#if card}
    <div class="layout">
      <div class="main">
        <textarea
          class="title-input"
          rows="1"
          maxlength="500"
          aria-label="Titre de la carte"
          bind:value={title}
          onfocus={() => (focused = 'title')}
          onblur={() => onblur('title')}
          onkeydown={ontitlekey}
          {@attach autosize(title, 200)}
        ></textarea>

        <div class="field">
          <label class="label" for="{uid}-desc">Description</label>
          <textarea
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

        <AssigneeEditor {card} onsaved={flashSaved} />
      </div>

      <aside class="side" aria-label="Propriétés">
        <div class="field">
          <label class="label" for="{uid}-state">État</label>
          <div class="select-wrap" style:--c={column?.color ?? 'var(--text-subtle)'}>
            <span class="dot" aria-hidden="true"></span>
            <select id="{uid}-state" class="select" value={card.state_id} onchange={(e) => setState(Number(e.currentTarget.value))}>
              {#each board.states as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="field">
          <span class="label" id="{uid}-prio">Priorité</span>
          <div class="prio" role="radiogroup" aria-labelledby="{uid}-prio" tabindex="-1" onkeydown={onprioritykey}>
            {#each PRIORITIES as p (p.value)}
              {@const active = card.priority === p.value}
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
          <span class="sub">{priority(card.priority).name}</span>
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
          <label class="label" for="{uid}-start">Date de début</label>
          <div class="date-row">
            <input
              bind:this={startInput}
              id="{uid}-start"
              class="input num"
              type="date"
              value={card.start_date ?? ''}
              onchange={(e) => setStart(e.currentTarget.value)}
              onblur={(e) => {
                // Saisie incomplète ou invraisemblable : on réaffiche la date enregistrée.
                if (e.currentTarget.value && !plausible(e.currentTarget.value)) e.currentTarget.value = card?.start_date ?? '';
              }}
            />
            {#if card.start_date}
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
        </div>

        <div class="end" class:empty={!card.schedule}>
          <span class="label">Fin prévue</span>
          {#if card.schedule && end != null}
            <p class="end-date num">
              <strong>{formatLong(end)}</strong>
              <span class="muted">· {fmtWorkingDays(card.schedule.working_days)}</span>
            </p>
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

  /* ---------- Titre ---------- */

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
