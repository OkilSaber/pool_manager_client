<!--
  Assignés d'une carte : répartition de la charge (en % ou en j/h, le chiffrage de la carte faisant foi),
  occupation (% du temps de chacun) et date de début propre (vide : celle de la carte).
  Enregistre automatiquement dès que la liste est vide ou valide (total à 100 % à 0,01 près, occupations 1–100),
  avec anti-rebond pendant la frappe ; une répartition invalide n'est jamais envoyée.
  Les parts partent en pleine précision (ex. 200/7) : arrondies, le ceil() côté serveur pourrait ajouter un jour.

  Pauses : chaque assigné enregistré peut être mis en pause / repris (aujourd'hui) ; le dépliant « Pauses (n) »
  corrige les dates (début, reprise ; reprise vide = en cours) ou supprime une pause. Chaque action part au serveur
  et la carte renvoyée remplace celle du store (pas d'optimisme) ; un refus du serveur s'affiche en toast.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import {
    assigneeSchedule,
    cardSchedule,
    computeSchedule,
    DEFAULT_OCCUPANCY,
    formatLong,
    formatPause,
    formatShort,
    openPause,
    toDay
  } from '$lib/dates';
  import { board } from '$lib/stores/board.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Assignee } from '$lib/types/Assignee';
  import type { AssigneeInput } from '$lib/types/AssigneeInput';
  import type { Card } from '$lib/types/Card';
  import type { Pause } from '$lib/types/Pause';
  import type { Schedule } from '$lib/types/Schedule';
  import type { UpdatePause } from '$lib/types/UpdatePause';
  import Spinner from '$lib/components/Spinner.svelte';
  import { fmtEstimate, fmtNum, fmtPct, fmtWorkingDays, NNBSP } from '$lib/format';
  import { formatDay, formatDayRange } from '$lib/components/timeline/timeline';
  import Popover from './Popover.svelte';
  import { tooltip } from '$lib/tooltip';

  let { card, onsaved }: { card: Card; onsaved?: () => void } = $props();

  type Unit = 'pct' | 'jh';
  type Row = {
    user_id: number;
    /** Part en pourcentage, pleine précision ; null si la saisie n'est pas un nombre */
    pct: number | null;
    /** Occupation (% du temps), entier 1–100 attendu ; null si vide */
    occupancy: number | null;
    /** Date de début propre ; null = celle de la carte */
    start_date: string | null;
    /** Texte en cours de saisie de la part (affiché tel quel jusqu'à la sortie du champ) */
    entry: string | null;
  };

  /** Écart toléré sur le total (comme le serveur). */
  const TOLERANCE = 0.01;
  const EPS = 1e-9;
  const UNIT_KEY = 'pm.assignees.unit';

  const uid = $props.id();
  const addMenuId = `assign-add-${uid}`;
  let addMenu: Popover;

  let rows = $state<Row[]>([]);
  let dirty = $state(false);
  /**
   * Un champ d'une ligne a le focus : la liste ne suit pas la carte (modifiée par un autre membre) sous le
   * curseur ; elle se réaligne à la sortie du champ. Une saisie pas encore enregistrée (`dirty`) aussi.
   */
  let editing = $state(false);
  let syncedFor = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // ---------- Unité de saisie ----------

  function readUnit(): Unit {
    try {
      return localStorage.getItem(UNIT_KEY) === 'jh' ? 'jh' : 'pct';
    } catch {
      return 'pct';
    }
  }

  let unitPref = $state<Unit>(readUnit());
  /** Chiffrage de référence (> 0) ; sans lui, la saisie en j/h n'a pas de sens. */
  const estimate = $derived(card.estimate_days != null && card.estimate_days > 0 ? card.estimate_days : null);
  const unit = $derived<Unit>(unitPref === 'jh' && estimate != null ? 'jh' : 'pct');

  function setUnit(next: Unit) {
    if (next === 'jh' && estimate == null) return;
    unitPref = next;
    try {
      localStorage.setItem(UNIT_KEY, next);
    } catch {
      /* stockage indisponible : le choix ne sera pas retenu */
    }
    // Les saisies en cours étaient dans l'autre unité : on réaffiche les valeurs.
    for (const r of rows) r.entry = null;
  }

  // ---------- Synchronisation avec la carte ----------

  function toRow(a: Assignee): Row {
    return { user_id: a.user_id, pct: a.pct, occupancy: a.occupancy, start_date: a.start_date, entry: null };
  }

  /** Réaligne sur le serveur en gardant l'ordre affiché (le serveur trie par part décroissante). */
  function orderLike(current: Row[], server: Assignee[]): Row[] {
    const rank = new Map(current.map((r, i) => [r.user_id, i]));
    return server.map(toRow).sort((a, b) => (rank.get(a.user_id) ?? Infinity) - (rank.get(b.user_id) ?? Infinity));
  }

  $effect.pre(() => {
    const id = card.id;
    const server = card.assignees;
    const hold = dirty || editing;
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
      editing = false;
      rows = server.map(toRow);
    } else if (!hold) {
      rows = orderLike(untrack(() => $state.snapshot(rows)) as Row[], server);
    }
  });

  // ---------- Validation ----------

  const shareOk = (pct: number | null): pct is number => pct != null && Number.isFinite(pct) && pct > 0 && pct <= 100 + EPS;
  const occupancyOk = (o: number | null): o is number => o != null && Number.isInteger(o) && o >= 1 && o <= 100;

  const total = $derived(rows.reduce((s, r) => s + (r.pct ?? 0), 0));
  const sharesOk = $derived(rows.every((r) => shareOk(r.pct)));
  const totalOk = $derived(Math.abs(total - 100) <= TOLERANCE + EPS);
  const occupanciesOk = $derived(rows.every((r) => occupancyOk(r.occupancy)));
  const valid = $derived(rows.length === 0 || (sharesOk && totalOk && occupanciesOk));
  const available = $derived(board.members.filter((m) => !rows.some((r) => r.user_id === m.user_id)));

  function name(userId: number): string {
    return board.member(userId)?.display_name ?? 'Membre retiré';
  }

  // ---------- Affichage des parts ----------

  const inputFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, useGrouping: false });

  /** Valeur affichée d'une part dans l'unité courante (2 décimales au plus). */
  function shown(r: Row): string {
    if (r.entry != null) return r.entry;
    if (r.pct == null) return '';
    return inputFmt.format(unit === 'jh' && estimate != null ? (estimate * r.pct) / 100 : r.pct);
  }

  /** Saisie décimale libre (virgule ou point, espaces ignorés) ; null si vide ou invalide. */
  function parseDecimal(raw: string): number | null {
    const s = raw.replace(/\s/g, '').replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Total en j/h (2 décimales), pour la ligne « Total : 8 / 10 j/h ». */
  const totalDays = $derived(estimate != null ? Math.round(((estimate * total) / 100) * 100) / 100 : 0);

  // ---------- Planification par assigné (aperçu en direct, même avant enregistrement) ----------

  /** Assigné tel qu'enregistré sur la carte (pauses comprises) ; absent tant qu'une nouvelle ligne n'est pas enregistrée. */
  function saved(userId: number): Assignee | undefined {
    return card.assignees.find((a) => a.user_id === userId);
  }

  function rowSchedule(r: Row): Schedule | null {
    if (!shareOk(r.pct) || !occupancyOk(r.occupancy)) return null;
    const pauses = saved(r.user_id)?.pauses ?? [];
    return assigneeSchedule(card.start_date, r.start_date, card.estimate_days, Math.min(r.pct, 100), r.occupancy, pauses);
  }

  function rowHint(r: Row): string {
    if (estimate == null) return 'Sans chiffrage';
    if (!r.start_date && !card.start_date) return 'Sans date de début';
    if (!shareOk(r.pct) || !occupancyOk(r.occupancy)) return 'Valeurs à corriger';
    return 'Non planifiable';
  }

  const schedules = $derived(rows.map(rowSchedule));
  const aggregate = $derived(
    rows.length ? cardSchedule(card.start_date, card.estimate_days, schedules) : computeSchedule(card.start_date, card.estimate_days)
  );

  // ---------- Enregistrement ----------

  function same(a: AssigneeInput[], b: Assignee[]): boolean {
    if (a.length !== b.length) return false;
    const m = new Map(b.map((x) => [x.user_id, x]));
    return a.every((x) => {
      const y = m.get(x.user_id);
      return (
        !!y &&
        Math.abs(y.pct - x.pct) < EPS &&
        y.occupancy === (x.occupancy ?? DEFAULT_OCCUPANCY) &&
        (y.start_date ?? null) === (x.start_date ?? null)
      );
    });
  }

  /**
   * Liste envoyable au serveur (vide, ou valide), sinon null. Parts en pleine précision ; un écart de total
   * dans la tolérance est absorbé par la dernière part, pour que la répartition couvre exactement le chiffrage.
   */
  function payloadOf(list: Row[]): AssigneeInput[] | null {
    if (list.length === 0) return [];
    let sum = 0;
    for (const r of list) {
      if (!shareOk(r.pct) || !occupancyOk(r.occupancy)) return null;
      sum += r.pct;
    }
    if (Math.abs(sum - 100) > TOLERANCE + EPS) return null;
    const out: AssigneeInput[] = list.map((r) => ({
      user_id: r.user_id,
      pct: Math.min(r.pct as number, 100),
      occupancy: r.occupancy as number,
      ...(r.start_date ? { start_date: r.start_date } : {})
    }));
    const last = out[out.length - 1];
    const others = sum - last.pct;
    const absorbed = 100 - others;
    if (Math.abs(absorbed - last.pct) > EPS && absorbed > 0 && absorbed <= 100) last.pct = absorbed;
    return out;
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
    // la répartition d'avant en cas d'échec (sinon l'écran montrerait une répartition « valide » jamais enregistrée).
    const now = payloadOf(rows);
    if (now && sameInputs(now, payload)) dirty = false;
  }

  function sameInputs(a: AssigneeInput[], b: AssigneeInput[]): boolean {
    return (
      a.length === b.length &&
      a.every(
        (x, i) =>
          x.user_id === b[i].user_id &&
          Math.abs(x.pct - b[i].pct) < EPS &&
          x.occupancy === b[i].occupancy &&
          (x.start_date ?? null) === (b[i].start_date ?? null)
      )
    );
  }

  function invalidReason(): string {
    if (!sharesOk || !totalOk)
      return estimate != null && unit === 'jh'
        ? `la répartition doit totaliser le chiffrage (${fmtEstimate(estimate)})`
        : `le total doit faire 100${NNBSP}%`;
    return `l’occupation doit être entre 1 et 100${NNBSP}%`;
  }

  // Modale fermée pendant l'anti-rebond : on enregistre quand même ce qui est valide,
  // et on signale une répartition invalide abandonnée plutôt que de la perdre en silence.
  $effect(() => () => {
    if (timer) {
      clearTimeout(timer);
      save();
    }
    if (dirty && !payloadOf(rows) && board.card(card.id)) toast.info(`Répartition non enregistrée${NNBSP}: ${invalidReason()}.`);
  });

  // ---------- Édition ----------

  /** Parts égales en pleine précision (la dernière absorbe l'arrondi). */
  function even(list: Row[]): Row[] {
    const n = list.length;
    if (!n) return list;
    const share = 100 / n;
    return list.map((r, i) => ({ ...r, entry: null, pct: i === n - 1 ? 100 - share * (n - 1) : share }));
  }

  /** Ramène des parts à 100 en gardant leurs proportions (pleine précision, la dernière absorbe l'arrondi). */
  function normalize(list: Row[]): Row[] {
    const sum = list.reduce((s, r) => s + (r.pct ?? 0), 0);
    if (!(sum > 0)) return even(list);
    const scaled = list.map((r) => ({ ...r, entry: null, pct: ((r.pct ?? 0) * 100) / sum }));
    const others = scaled.slice(0, -1).reduce((s, r) => s + (r.pct ?? 0), 0);
    scaled[scaled.length - 1].pct = Math.min(100, Math.max(Number.MIN_VALUE, 100 - others));
    return scaled;
  }

  function add(userId: number) {
    addMenu?.hide();
    const fresh: Row = { user_id: userId, pct: null, occupancy: DEFAULT_OCCUPANCY, start_date: null, entry: null };
    if (rows.length === 0) rows = [{ ...fresh, pct: 100 }];
    else if (valid) rows = even([...rows, fresh]);
    else rows = [...rows, { ...fresh, pct: Math.min(100, Math.max(1, 100 - total)) }];
    queue(0);
  }

  function remove(userId: number) {
    const wasValid = valid;
    let rest = rows.filter((r) => r.user_id !== userId);
    if (rest.length === 1) rest = [{ ...rest[0], pct: 100, entry: null }];
    else if (rest.length > 1 && wasValid) rest = normalize(rest);
    rows = rest;
    queue(0);
  }

  function split() {
    rows = even(rows);
    queue(0);
  }

  function onshareinput(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const raw = e.currentTarget.value;
    const v = parseDecimal(raw);
    rows[i].entry = raw;
    rows[i].pct = v == null ? null : unit === 'jh' && estimate != null ? (v * 100) / estimate : v;
    queue(400);
  }

  function onoccupancyinput(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.value.trim();
    const n = v === '' ? null : Number(v);
    rows[i].occupancy = n == null || !Number.isFinite(n) ? null : n;
    queue(400);
  }

  /** Date saisie au clavier : incomplète ou invraisemblable, elle n'est pas prise en compte. */
  function plausible(date: string): boolean {
    const y = Number(date.slice(0, 4));
    return toDay(date) != null && y >= 1970 && y <= 2200;
  }

  function onstartchange(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.value;
    if (v && !plausible(v)) return;
    rows[i].start_date = v || null;
    queue(0);
  }

  function onstartblur(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.value;
    if (v && !plausible(v)) e.currentTarget.value = rows[i].start_date ?? card.start_date ?? '';
  }

  function inherit(i: number, e: MouseEvent) {
    rows[i].start_date = null;
    queue(0);
    // Le bouton disparaît : le focus passe au champ de date au lieu de tomber sur <body>.
    (e.currentTarget as HTMLElement).closest('.start')?.querySelector('input')?.focus();
  }

  function onrowsfocus(e: FocusEvent) {
    editing = e.type === 'focusin' && e.target instanceof HTMLInputElement;
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      save();
    }
  }

  function onshareblur(i: number) {
    if (rows[i]) rows[i].entry = null;
    flush();
  }

  // ---------- Pauses ----------

  /** Assigné dont une pause / reprise est en cours d'envoi. */
  let pausing = $state<number | null>(null);
  /** Assignés dont l'historique des pauses est déplié. */
  let expanded = $state<number[]>([]);
  let confirmPause = $state<number | null>(null);
  let confirmPauseTimer: ReturnType<typeof setTimeout> | undefined;

  function toggleHistory(userId: number) {
    expanded = expanded.includes(userId) ? expanded.filter((id) => id !== userId) : [...expanded, userId];
  }

  async function togglePause(userId: number) {
    // Répartition en attente d'abord : le serveur doit connaître la personne (la file de la carte garde l'ordre).
    flush();
    const a = saved(userId);
    if (!a || pausing != null) return;
    pausing = userId;
    const ok = openPause(a) ? await board.resumeAssignee(card.id, userId) : await board.pauseAssignee(card.id, userId);
    pausing = null;
    if (ok) onsaved?.();
  }

  /** Corrections de dates en attente (une saisie au clavier change la date à chaque segment tapé). */
  const pauseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function pauseValue(p: Pause, field: 'start' | 'end'): string {
    return field === 'start' ? p.start_date : (p.end_date ?? '');
  }

  function onpausechange(p: Pause, field: 'start' | 'end', e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const key = `${p.id}:${field}`;
    clearTimeout(pauseTimers.get(key));
    pauseTimers.set(
      key,
      setTimeout(() => commitPause(p, field, input), 500)
    );
  }

  function onpauseblur(p: Pause, field: 'start' | 'end', e: Event & { currentTarget: HTMLInputElement }) {
    const key = `${p.id}:${field}`;
    if (!pauseTimers.has(key)) return;
    clearTimeout(pauseTimers.get(key));
    commitPause(p, field, e.currentTarget);
  }

  async function commitPause(p: Pause, field: 'start' | 'end', input: HTMLInputElement) {
    pauseTimers.delete(`${p.id}:${field}`);
    const v = input.value;
    const reset = () => {
      if (input.isConnected) input.value = pauseValue(p, field);
    };
    let patch: UpdatePause;
    if (field === 'start') {
      // Début obligatoire : vide ou invraisemblable, on réaffiche la date enregistrée.
      if (!v || !plausible(v)) return reset();
      if (v === p.start_date) return;
      patch = { start_date: v };
    } else {
      if (v && !plausible(v)) return reset();
      const next = v || null; // vide : pause rouverte (en cours)
      if (next === p.end_date) return;
      patch = { end_date: next };
    }
    const ok = await board.updatePause(card.id, p.id, patch);
    if (ok) onsaved?.();
    else reset();
  }

  async function removePause(p: Pause) {
    if (confirmPause !== p.id) {
      confirmPause = p.id;
      clearTimeout(confirmPauseTimer);
      confirmPauseTimer = setTimeout(() => (confirmPause = null), 3000);
      return;
    }
    clearTimeout(confirmPauseTimer);
    confirmPause = null;
    if (await board.deletePause(card.id, p.id)) onsaved?.();
  }

  $effect(() => () => {
    clearTimeout(confirmPauseTimer);
    for (const t of pauseTimers.values()) clearTimeout(t);
  });
</script>

<section class="assignees" aria-labelledby="{uid}-title">
  <div class="head">
    <h3 class="label" id="{uid}-title">Assignés</h3>
    <div class="head-actions">
      {#if rows.length > 0}
        <div class="seg" role="group" aria-label="Unité de la répartition">
          <button type="button" class:active={unit === 'pct'} aria-pressed={unit === 'pct'} onclick={() => setUnit('pct')}>%</button>
          <button
            type="button"
            class:active={unit === 'jh'}
            aria-pressed={unit === 'jh'}
            aria-disabled={estimate == null}
            aria-label={estimate == null ? 'j/h (ajoutez un chiffrage)' : 'j/h'}
            onclick={() => setUnit('jh')}
            {@attach tooltip(estimate == null ? 'Ajoutez un chiffrage pour répartir en j/h' : null)}
          >
            j/h
          </button>
        </div>
      {/if}
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
    <ul class="rows" onfocusin={onrowsfocus} onfocusout={onrowsfocus}>
      {#each rows as row, i (row.user_id)}
        {@const who = name(row.user_id)}
        {@const okShare = shareOk(row.pct)}
        {@const okOcc = occupancyOk(row.occupancy)}
        {@const sched = schedules[i]}
        {@const end = sched ? toDay(sched.end) : null}
        {@const serverRow = saved(row.user_id)}
        {@const pauses = serverRow?.pauses ?? []}
        {@const current = serverRow ? openPause(serverRow) : null}
        <li class="row">
          <div class="line1">
            <Avatar id={row.user_id} name={who} size={24} />
            <span class="who" title={who}>
              {who}
              {#if row.user_id === session.user?.id}<span class="you">(vous)</span>{/if}
            </span>
            <span class="bar" aria-hidden="true">
              <span class="fill" style:transform="scaleX({Math.min(Math.max(row.pct ?? 0, 0), 100) / 100})"></span>
            </span>
            <span class="share-field" class:invalid={!okShare}>
              <input
                class="share num"
                class:wide={unit === 'jh'}
                type="text"
                inputmode="decimal"
                autocomplete="off"
                spellcheck="false"
                value={shown(row)}
                aria-label={unit === 'jh' ? `Part de ${who} en jours/homme` : `Part de ${who} en pourcentage`}
                aria-invalid={!okShare}
                oninput={(e) => onshareinput(i, e)}
                onblur={() => onshareblur(i)}
              />
              <span class="suffix" aria-hidden="true">{unit === 'jh' ? 'j/h' : '%'}</span>
            </span>
            <button
              class="btn btn-ghost btn-sm btn-icon"
              type="button"
              aria-label="Retirer {who}"
              onclick={() => remove(row.user_id)}
              {@attach tooltip('Retirer')}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <div class="line2">
            <span class="occ" class:invalid={!okOcc} {@attach tooltip('Part de son temps consacrée à la carte')}>
              <input
                class="mini num"
                type="number"
                inputmode="numeric"
                min="1"
                max="100"
                step="1"
                value={row.occupancy ?? ''}
                aria-label="Occupation de {who}, en pourcentage de son temps"
                aria-invalid={!okOcc}
                oninput={(e) => onoccupancyinput(i, e)}
                onblur={flush}
              />
              <span class="unit" aria-hidden="true">%{NNBSP}du temps</span>
            </span>

            <span class="start">
              <span class="unit" aria-hidden="true">dès le</span>
              <input
                class="mini date num"
                class:inherited={!row.start_date}
                type="date"
                value={row.start_date ?? card.start_date ?? ''}
                aria-label={row.start_date
                  ? `Date de début de ${who}`
                  : `Date de début de ${who} (comme la carte${card.start_date ? '' : ', qui n’en a pas'})`}
                onchange={(e) => onstartchange(i, e)}
                onblur={(e) => onstartblur(i, e)}
              />
              {#if row.start_date}
                <button
                  class="btn btn-ghost btn-sm btn-icon reset"
                  type="button"
                  aria-label="Reprendre la date de la carte pour {who}"
                  onclick={(e) => inherit(i, e)}
                  {@attach tooltip('Reprendre la date de la carte')}
                >
                  <svg width="10" height="10" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                </button>
              {:else}
                <span class="hint">comme la carte</span>
              {/if}
            </span>

            <span class="result num" class:none={!sched}>
              {#if sched && end != null}
                → {formatDay(end)} · {fmtWorkingDays(sched.working_days)}
                {#if sched.paused_days > 0}
                  <span class="paused-days">+{sched.paused_days}{NNBSP}j de pause</span>
                {/if}
              {:else}
                {rowHint(row)}
              {/if}
            </span>

            {#if serverRow}
              <button
                class="btn btn-ghost btn-sm pause-btn"
                type="button"
                aria-busy={pausing === row.user_id}
                aria-label={current ? `Reprendre la part de ${who}` : `Mettre la part de ${who} en pause`}
                onclick={() => togglePause(row.user_id)}
                {@attach tooltip(current ? 'Reprendre aujourd’hui' : 'Mettre en pause à partir d’aujourd’hui')}
              >
                {#if pausing === row.user_id}
                  <Spinner size={10} />
                {:else if current}
                  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                  </svg>
                {:else}
                  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                {/if}
                {current ? 'Reprendre' : 'Pause'}
              </button>
            {/if}
          </div>

          {#if pauses.length}
            {@const open = expanded.includes(row.user_id)}
            <div class="line3">
              {#if current}
                {@const since = toDay(current.start_date)}
                <span class="paused-badge">
                  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                  {since != null ? `En pause depuis le ${formatShort(since)}` : 'En pause'}
                </span>
              {/if}
              <button
                class="history-toggle"
                type="button"
                aria-expanded={open}
                aria-controls="{uid}-pauses-{row.user_id}"
                onclick={() => toggleHistory(row.user_id)}
              >
                <svg class="chev" class:open width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                Pauses ({pauses.length})
              </button>
            </div>
            {#if open}
              <ul class="pauses" id="{uid}-pauses-{row.user_id}" aria-label="Pauses de {who}">
                {#each pauses as p (p.id)}
                  <li class="pause">
                    <span class="unit" aria-hidden="true">du</span>
                    <input
                      class="mini date num"
                      type="date"
                      value={p.start_date}
                      aria-label="Premier jour de pause de {who} ({formatPause(p)})"
                      onchange={(e) => onpausechange(p, 'start', e)}
                      onblur={(e) => onpauseblur(p, 'start', e)}
                    />
                    <span class="unit" aria-hidden="true">reprise le</span>
                    <input
                      class="mini date num"
                      class:inherited={p.end_date == null}
                      type="date"
                      value={p.end_date ?? ''}
                      aria-label={p.end_date ? `Jour de reprise de ${who}` : `Jour de reprise de ${who} (vide : pause en cours)`}
                      onchange={(e) => onpausechange(p, 'end', e)}
                      onblur={(e) => onpauseblur(p, 'end', e)}
                    />
                    {#if p.end_date == null}<span class="hint">en cours</span>{/if}
                    <button
                      class="btn btn-sm pause-del"
                      class:btn-ghost={confirmPause !== p.id}
                      class:btn-danger={confirmPause === p.id}
                      class:btn-icon={confirmPause !== p.id}
                      type="button"
                      aria-label={confirmPause === p.id ? `Confirmer la suppression de la pause (${formatPause(p)})` : `Supprimer la pause (${formatPause(p)})`}
                      onclick={() => removePause(p)}
                      {@attach tooltip(confirmPause === p.id ? null : 'Supprimer la pause')}
                    >
                      {#if confirmPause === p.id}
                        Confirmer
                      {:else}
                        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" />
                        </svg>
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>

    <div class="total" class:ok={sharesOk && totalOk} role="status">
      {#if sharesOk && totalOk}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5l6 11H2l6-11z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round" />
          <path d="M8 6.5v3M8 11.6v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      {/if}
      {#if unit === 'jh' && estimate != null}
        <span class="num">Total{NNBSP}: {fmtNum(totalDays)} / {fmtEstimate(estimate)}</span>
        {#if !(sharesOk && totalOk)}
          <span class="msg">La répartition doit totaliser le chiffrage</span>
        {/if}
      {:else}
        <span class="num">Total{NNBSP}: {fmtPct(Math.round(total * 100) / 100)}</span>
        {#if !(sharesOk && totalOk)}
          <span class="msg">La répartition doit totaliser 100{NNBSP}%</span>
        {/if}
      {/if}
    </div>
  {/if}

  <p class="effect">
    {#if estimate == null}
      Ajoutez un chiffrage pour calculer la durée.
    {:else if !aggregate}
      Ajoutez une date de début pour planifier la carte.
    {:else if rows.length > 1}
      Ensemble{NNBSP}: <strong class="num">{formatDayRange(toDay(aggregate.start) ?? 0, toDay(aggregate.end) ?? 0)}</strong>
      <span class="muted">· {fmtWorkingDays(aggregate.working_days)}</span>
    {:else}
      Durée{NNBSP}: <strong class="num">{fmtWorkingDays(aggregate.working_days)}</strong>
      · fin prévue <strong class="num">{formatLong(toDay(aggregate.end) ?? 0)}</strong>
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
    align-items: center;
    gap: 2px;
  }

  h3.label {
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
  }

  /* Bascule d'unité : même dessin que l'échelle de la chronologie, en plus compact. */
  .seg {
    display: inline-flex;
    gap: 2px;
    margin-right: 6px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
  }

  .seg button {
    height: 20px;
    min-width: 28px;
    padding: 0 7px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition:
      transform var(--dur-press) var(--ease-out),
      color var(--dur-hover) ease;
  }

  .seg button:active:not([aria-disabled='true']) {
    transform: scale(0.97);
  }

  .seg button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }

  .seg button[aria-disabled='true'] {
    color: var(--text-subtle);
    cursor: default;
  }

  .seg button:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  @media (prefers-color-scheme: dark) {
    .seg {
      background: var(--surface-2);
    }
    .seg button.active {
      background: var(--surface-3);
    }
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
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Un assigné = un petit bloc : nom et part, puis occupation, date de début et résultat. */
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 6px 8px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .line1 {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 56px 84px 26px;
    align-items: center;
    gap: 10px;
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

  .share-field {
    position: relative;
    display: block;
  }

  .share,
  .mini {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    -moz-appearance: textfield;
    appearance: textfield;
    transition:
      border-color var(--dur-hover) ease,
      box-shadow var(--dur-hover) ease;
  }

  .share {
    width: 100%;
    height: 28px;
    padding: 0 22px 0 8px;
    font-size: 13px;
    text-align: right;
  }

  .share.wide {
    padding-right: 30px;
  }

  .mini::-webkit-outer-spin-button,
  .mini::-webkit-inner-spin-button {
    margin: 0;
    -webkit-appearance: none;
  }

  .share:focus,
  .mini:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus);
  }

  .invalid .share,
  .invalid .mini {
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

  /* Deuxième ligne alignée sur le nom (avatar 24 + écart 10). */
  .line2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding-left: 34px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .occ,
  .start {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .unit,
  .hint {
    white-space: nowrap;
  }

  .hint {
    color: var(--text-subtle);
  }

  .mini {
    height: 24px;
    padding: 0 6px;
    font-size: 12px;
  }

  .occ .mini {
    width: 44px;
    text-align: right;
  }

  .date {
    width: 128px;
  }

  /* Date héritée de la carte : affichée en retrait, c'est un rappel, pas une valeur propre. */
  .date.inherited:not(:focus) {
    color: var(--text-subtle);
  }

  .start .reset {
    width: 20px;
    height: 20px;
  }

  .result {
    color: var(--text);
    font-weight: 500;
    white-space: nowrap;
  }

  .result.none {
    font-weight: 400;
    color: var(--text-subtle);
  }

  /* ---------- Pauses ---------- */

  /* Ambre discret (priorité P2) mélangé au texte : lisible en clair comme en sombre. */
  .paused-days,
  .paused-badge {
    color: color-mix(in srgb, var(--p2) 70%, var(--text));
  }

  .paused-days {
    margin-left: 4px;
    font-weight: 400;
  }

  .pause-btn {
    height: 22px;
    margin-left: auto;
    padding: 0 6px;
    gap: 4px;
    font-size: 12px;
  }

  .line3 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding-left: 34px;
    font-size: 12px;
  }

  .paused-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--p2) 14%, transparent);
    font-weight: 500;
    white-space: nowrap;
  }

  .history-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 4px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
  }

  .history-toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  @media (hover: hover) and (pointer: fine) {
    .history-toggle:hover {
      color: var(--text);
    }
  }

  .chev {
    transition: transform 150ms var(--ease-out);
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .pauses {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0 0 0 34px;
    list-style: none;
  }

  .pause {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .pause-del {
    height: 22px;
    font-size: 12px;
  }

  .pause-del.btn-icon {
    width: 22px;
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

  @media (prefers-reduced-motion: reduce) {
    .seg button:active {
      transform: none;
    }
    .chev {
      transition: none;
    }
  }
</style>
