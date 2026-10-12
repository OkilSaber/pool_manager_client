<!--
  Assignés d'une carte et répartition de la charge (en %).
  Enregistre automatiquement dès que la liste est vide ou totalise exactement 100 %
  (anti-rebond pendant la frappe) ; une répartition invalide n'est jamais envoyée.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { computeSchedule, formatLong, toDay, workingDays } from '$lib/dates';
  import { board } from '$lib/stores/board.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Assignee } from '$lib/types/Assignee';
  import type { Card } from '$lib/types/Card';
  import { fmtPct, fmtWorkingDays, NNBSP } from '$lib/format';
  import Popover from './Popover.svelte';
  import { tooltip } from '$lib/tooltip';

  let { card, onsaved }: { card: Card; onsaved?: () => void } = $props();

  type Row = { user_id: number; pct: number | null };

  const uid = $props.id();
  const addMenuId = `assign-add-${uid}`;
  let addMenu: Popover;

  let rows = $state<Row[]>([]);
  let dirty = $state(false);
  let syncedFor = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Réaligne sur le serveur en gardant l'ordre affiché (le serveur trie par part décroissante). */
  function orderLike(current: Row[], server: Assignee[]): Row[] {
    const rank = new Map(current.map((r, i) => [r.user_id, i]));
    return server
      .map((a) => ({ user_id: a.user_id, pct: a.pct }))
      .sort((a, b) => (rank.get(a.user_id) ?? Infinity) - (rank.get(b.user_id) ?? Infinity));
  }

  $effect.pre(() => {
    const id = card.id;
    const server = card.assignees;
    if (id !== syncedFor) {
      // Modale rouverte aussitôt sur une autre carte (contenu pas encore démonté) : la répartition
      // en attente concerne la carte précédente, on l'enregistre avant de réinitialiser.
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        const prev = syncedFor;
        untrack(() => {
          const payload = payloadOf(rows);
          const before = board.card(prev);
          if (payload && before && !same(payload, before.assignees)) board.setAssignees(prev, payload);
        });
      }
      syncedFor = id;
      dirty = false;
      rows = server.map((a) => ({ user_id: a.user_id, pct: a.pct }));
    } else if (!dirty) {
      rows = orderLike(untrack(() => $state.snapshot(rows)) as Row[], server);
    }
  });

  const total = $derived(rows.reduce((s, r) => s + (r.pct ?? 0), 0));
  const rowsValid = $derived(rows.every((r) => r.pct != null && Number.isInteger(r.pct) && r.pct >= 1 && r.pct <= 100));
  const valid = $derived(rows.length === 0 || (rowsValid && total === 100));
  const available = $derived(board.members.filter((m) => !rows.some((r) => r.user_id === m.user_id)));

  // Effet de la répartition sur la durée (aperçu en direct, même avant enregistrement).
  const pcts = $derived(rows.map((r) => r.pct ?? 0));
  const duration = $derived(workingDays(card.estimate_days, pcts));
  const schedule = $derived(computeSchedule(card.start_date, card.estimate_days, pcts));
  const maxShare = $derived(rows.length ? Math.max(...pcts) : 100);

  function name(userId: number): string {
    return board.member(userId)?.display_name ?? 'Membre retiré';
  }

  // ---------- Enregistrement ----------

  function same(a: { user_id: number; pct: number | null }[], b: { user_id: number; pct: number | null }[]): boolean {
    if (a.length !== b.length) return false;
    const m = new Map(b.map((x) => [x.user_id, x.pct]));
    return a.every((x) => m.get(x.user_id) === x.pct);
  }

  /** Liste envoyable au serveur (vide, ou parts entières 1–100 totalisant 100), sinon null. */
  function payloadOf(list: Row[]): Assignee[] | null {
    if (list.length === 0) return [];
    let sum = 0;
    for (const r of list) {
      if (r.pct == null || !Number.isInteger(r.pct) || r.pct < 1 || r.pct > 100) return null;
      sum += r.pct;
    }
    return sum === 100 ? list.map((r) => ({ user_id: r.user_id, pct: r.pct as number })) : null;
  }

  function queue(delay: number) {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  }

  async function save() {
    timer = undefined;
    const id = card.id;
    const payload = payloadOf(rows);
    if (!payload) return; // répartition invalide : jamais envoyée, la saisie reste affichée
    const current = board.card(id);
    if (!current) return; // carte supprimée entre-temps
    if (same(payload, current.assignees)) {
      dirty = false;
      return;
    }
    const ok = await board.setAssignees(id, payload);
    if (id !== card.id) return;
    if (ok) onsaved?.();
    // Rien n'a bougé pendant la requête : on se réaligne sur le store — la réponse serveur en cas de succès,
    // la répartition enregistrée en cas d'échec (sinon l'écran montrerait une répartition « valide » jamais enregistrée).
    if (same(rows, payload)) dirty = false;
  }

  // Modale fermée pendant l'anti-rebond : on enregistre quand même ce qui est valide,
  // et on signale une répartition invalide abandonnée plutôt que de la perdre en silence.
  $effect(() => () => {
    if (timer) {
      clearTimeout(timer);
      save();
    }
    if (dirty && !payloadOf(rows) && board.card(card.id)) toast.info(`Répartition non enregistrée${NNBSP}: le total doit faire 100${NNBSP}%.`);
  });

  // ---------- Édition ----------

  function even(list: Row[]): Row[] {
    const n = list.length;
    if (!n) return list;
    const base = Math.floor(100 / n);
    const extra = 100 - base * n;
    return list.map((r, i) => ({ ...r, pct: base + (i < extra ? 1 : 0) }));
  }

  /** Ramène des parts à 100 en gardant leurs proportions (plus forts restes, minimum 1). */
  function normalize(list: Row[]): Row[] {
    const sum = list.reduce((s, r) => s + (r.pct ?? 0), 0);
    if (!sum) return even(list);
    const raw = list.map((r) => ((r.pct ?? 0) * 100) / sum);
    const floors = raw.map((x) => Math.max(1, Math.floor(x)));
    let left = 100 - floors.reduce((s, x) => s + x, 0);
    const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) floors[order[k].i]++;
    return list.map((r, i) => ({ ...r, pct: floors[i] }));
  }

  function add(userId: number) {
    addMenu?.hide();
    if (rows.length === 0) rows = [{ user_id: userId, pct: 100 }];
    else if (valid) rows = even([...rows, { user_id: userId, pct: null }]);
    else rows = [...rows, { user_id: userId, pct: Math.min(100, Math.max(1, 100 - total)) }];
    queue(0);
  }

  function remove(userId: number) {
    const wasValid = valid;
    let rest = rows.filter((r) => r.user_id !== userId);
    if (rest.length === 1) rest = [{ ...rest[0], pct: 100 }];
    else if (rest.length > 1 && wasValid) rest = normalize(rest);
    rows = rest;
    queue(0);
  }

  function split() {
    rows = even(rows);
    queue(0);
  }

  function oninput(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.value.trim();
    const n = v === '' ? null : Number(v);
    rows[i].pct = n == null || !Number.isFinite(n) ? null : n;
    queue(400);
  }

  function onblur() {
    if (timer) {
      clearTimeout(timer);
      save();
    }
  }
</script>

<section class="assignees" aria-labelledby="{uid}-title">
  <div class="head">
    <h3 class="label" id="{uid}-title">Assignés</h3>
    <div class="head-actions">
      {#if rows.length > 1}
        <button class="btn btn-ghost btn-sm" type="button" onclick={split}>Répartir équitablement</button>
      {/if}
      <button class="btn btn-ghost btn-sm" type="button" popovertarget={addMenuId} disabled={available.length === 0}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        Ajouter
      </button>
    </div>
  </div>

  {#if rows.length === 0}
    <p class="empty">Personne n’est assigné. Ajoutez des membres pour répartir la charge.</p>
  {:else}
    <ul class="rows">
      {#each rows as row, i (row.user_id)}
        {@const ok = row.pct != null && Number.isInteger(row.pct) && row.pct >= 1 && row.pct <= 100}
        <li class="row">
          <Avatar id={row.user_id} name={name(row.user_id)} size={24} />
          <span class="who" title={name(row.user_id)}>
            {name(row.user_id)}
            {#if row.user_id === session.user?.id}<span class="you">(vous)</span>{/if}
          </span>
          <span class="bar" aria-hidden="true">
            <span class="fill" style:transform="scaleX({Math.min(Math.max(row.pct ?? 0, 0), 100) / 100})"></span>
          </span>
          <span class="pct-field" class:invalid={!ok}>
            <input
              class="pct num"
              type="number"
              inputmode="numeric"
              min="1"
              max="100"
              step="1"
              value={row.pct ?? ''}
              aria-label="Part de {name(row.user_id)} en pourcentage"
              aria-invalid={!ok}
              oninput={(e) => oninput(i, e)}
              {onblur}
            />
            <span class="suffix" aria-hidden="true">%</span>
          </span>
          <button
            class="btn btn-ghost btn-sm btn-icon"
            type="button"
            aria-label="Retirer {name(row.user_id)}"
            onclick={() => remove(row.user_id)}
            {@attach tooltip('Retirer')}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>

    <div class="total" class:ok={valid} role="status">
      {#if valid}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5l6 11H2l6-11z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round" />
          <path d="M8 6.5v3M8 11.6v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      {/if}
      <span class="num">Total{NNBSP}: {fmtPct(total)}</span>
      {#if !valid}
        <span class="msg">La répartition doit totaliser 100{NNBSP}%</span>
      {/if}
    </div>
  {/if}

  <p class="effect">
    {#if duration == null}
      Ajoutez un chiffrage pour calculer la durée.
    {:else}
      Durée{NNBSP}: <strong class="num">{fmtWorkingDays(duration)}</strong>
      {#if rows.length > 1}
        <span class="muted">(part la plus forte{NNBSP}: {fmtPct(maxShare)})</span>
      {/if}
      {#if schedule}
        · fin prévue <strong class="num">{formatLong(toDay(schedule.end) ?? 0)}</strong>
      {/if}
    {/if}
  </p>
</section>

<Popover bind:this={addMenu} id={addMenuId} label="Ajouter un assigné" minWidth={240}>
  {#each available as m (m.user_id)}
    <button class="mi member" type="button" role="menuitem" onclick={() => add(m.user_id)}>
      <Avatar id={m.user_id} name={m.display_name} size={20} />
      <span class="mi-text">
        <span class="mi-name">{m.display_name}</span>
        <span class="mi-email">{m.email}</span>
      </span>
    </button>
  {:else}
    <p class="none">Tous les membres sont déjà assignés.</p>
  {/each}
</Popover>

<style>
  .assignees {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 26px;
  }

  .head-actions {
    display: flex;
    gap: 2px;
  }

  h3.label {
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
  }

  .empty {
    margin: 0;
    padding: 10px 12px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 72px 72px 26px;
    align-items: center;
    gap: 10px;
    min-height: 36px;
  }

  .who {
    overflow: hidden;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .you {
    margin-left: 2px;
    font-weight: 400;
    color: var(--text-muted);
  }

  .bar {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--surface-3);
  }

  .fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--accent);
    transform-origin: left center;
  }

  .pct-field {
    position: relative;
    display: block;
  }

  .pct {
    width: 100%;
    height: 28px;
    padding: 0 22px 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    text-align: right;
    -moz-appearance: textfield;
    appearance: textfield;
    transition:
      border-color var(--dur-hover) ease,
      box-shadow var(--dur-hover) ease;
  }

  .pct::-webkit-outer-spin-button,
  .pct::-webkit-inner-spin-button {
    margin: 0;
    -webkit-appearance: none;
  }

  .pct:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus);
  }

  .invalid .pct {
    border-color: color-mix(in srgb, var(--warning) 60%, var(--border));
  }

  .suffix {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    font-size: 12px;
    color: var(--text-subtle);
    pointer-events: none;
  }

  /*
   * La couleur d'état est portée par l'icône ; le texte reste lisible (orange ou vert purs ≈ 3:1 sur blanc).
   * Total valide : ton calme ; invalide : orange mélangé à --text (assombri en clair, éclairci en sombre).
   */
  .total {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 500;
    color: color-mix(in srgb, var(--warning) 60%, var(--text));
  }

  .total svg {
    flex: none;
    color: var(--warning);
  }

  .total.ok {
    color: var(--text-muted);
  }

  .total.ok svg {
    color: var(--success);
  }

  .total .msg {
    font-weight: 400;
    color: var(--text-muted);
  }

  .effect {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .effect strong {
    font-weight: 600;
    color: var(--text);
  }

  button.mi.member {
    min-height: 40px;
    padding-block: 4px;
  }

  .mi-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }

  .mi-name {
    overflow: hidden;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .mi-email {
    overflow: hidden;
    font-size: 11.5px;
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .none {
    margin: 0;
    padding: 8px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
</style>
