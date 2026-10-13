// Calculs purs de la chronologie : plage de dates, positions, en-têtes, regroupements, formats.
// Tout est en jours epoch (cf. $lib/dates) : aucune dépendance au fuseau horaire.

import {
  dayOfMonth,
  formatLong,
  formatMonth,
  formatShort,
  isoWeek,
  isWeekend,
  openPause,
  pauseIntervals,
  planDays,
  startOfMonth,
  startOfWeek,
  today,
  toDay,
  weekday,
  type PauseSpan
} from '$lib/dates';
import type { Assignee } from '$lib/types/Assignee';
import type { Card } from '$lib/types/Card';
import type { Pause } from '$lib/types/Pause';
import type { Member } from '$lib/types/Member';
import { glyphColor } from '$lib/components/CardTypeIcon.svelte';
import type { CardType } from '$lib/types/CardType';
import type { Project } from '$lib/types/Project';
import type { Schedule } from '$lib/types/Schedule';
import type { State } from '$lib/types/State';

// ---------- Réglages ----------

export type Zoom = 'day' | 'week' | 'month';
export type GroupBy = 'project' | 'state' | 'type' | 'assignee' | 'none';

export const ZOOMS: { value: Zoom; label: string; dayWidth: number }[] = [
  { value: 'day', label: 'Jour', dayWidth: 40 },
  { value: 'week', label: 'Semaine', dayWidth: 16 },
  { value: 'month', label: 'Mois', dayWidth: 5 }
];

export const GROUP_BYS: { value: GroupBy; label: string }[] = [
  { value: 'project', label: 'Projet' },
  { value: 'state', label: 'État' },
  { value: 'type', label: 'Type' },
  { value: 'assignee', label: 'Assigné' },
  { value: 'none', label: 'Aucun' }
];

export function dayWidthOf(zoom: Zoom): number {
  return ZOOMS.find((z) => z.value === zoom)?.dayWidth ?? 16;
}

export function isZoom(v: unknown): v is Zoom {
  return v === 'day' || v === 'week' || v === 'month';
}

export function isGroupBy(v: unknown): v is GroupBy {
  return v === 'project' || v === 'state' || v === 'type' || v === 'assignee' || v === 'none';
}

/** Regroupements proposés : « Projet » seulement dans un pool, « Type » seulement s'il existe des types. */
export function isGroupByAvailable(g: GroupBy, kind: 'pool' | 'project' | null, hasTypes: boolean): boolean {
  if (g === 'project') return kind === 'pool';
  if (g === 'type') return hasTypes;
  return true;
}

/**
 * Regroupement effectif : la préférence enregistrée si elle a un sens pour ce tableau
 * (« Projet » n'en a pas dans une vue projet, « Type » sans types), sinon « Projet » dans un pool et « État » ailleurs.
 */
export function resolveGroupBy(pref: GroupBy | null, kind: 'pool' | 'project' | null, hasTypes: boolean): GroupBy {
  if (pref != null && isGroupByAvailable(pref, kind, hasTypes)) return pref;
  return kind === 'pool' ? 'project' : 'state';
}

/** Dimensions partagées par les composants (px). */
export const LABEL_WIDTH = 260;
export const ROW_HEIGHT = 36;
export const GROUP_HEIGHT = 32;
export const HEADER_ROW1 = 24;
export const HEADER_ROW2 = 28;
export const HEADER_HEIGHT = HEADER_ROW1 + HEADER_ROW2;

// ---------- Plage affichée ----------

export interface Range {
  /** Premier jour (un lundi) */
  start: number;
  /** Dernier jour inclus (un dimanche) */
  end: number;
  days: number;
}

/**
 * De min(début des cartes, aujourd'hui) − 7 j à max(fin des cartes, aujourd'hui) + 35 j,
 * alignée sur des semaines entières (lundi → dimanche), et au moins `minDays` jours.
 * `leadDays` / `trailDays` : jours à garder avant / après aujourd'hui pour pouvoir le placer au quart gauche
 * de la zone visible quel que soit le zoom. `keep` : jours à inclure en plus (semaines entières).
 */
export function computeRange(
  cards: Card[],
  todayDay: number,
  minDays = 70,
  leadDays = 7,
  trailDays = 35,
  keep: { from: number; to: number } | null = null
): Range {
  let lo = todayDay;
  let hi = todayDay;
  for (const c of cards) {
    const s = toDay(c.schedule?.start);
    const e = toDay(c.schedule?.end);
    if (s != null && s < lo) lo = s;
    if (e != null && e > hi) hi = e;
  }
  let start = startOfWeek(Math.min(lo - 7, todayDay - leadDays));
  let end = startOfWeek(Math.max(hi + 35, todayDay + trailDays)) + 6;
  // Jours à garder dans la plage quoi qu'il arrive (zone ancrée lors d'un changement de zoom).
  if (keep) {
    start = Math.min(start, startOfWeek(keep.from));
    end = Math.max(end, startOfWeek(keep.to) + 6);
  }
  const min = Math.ceil(Math.max(minDays, 70) / 7) * 7;
  if (end - start + 1 < min) end = start + min - 1;
  return { start, end, days: end - start + 1 };
}

/** Abscisse (px) du début d'un jour dans la grille. */
export function dayX(day: number, rangeStart: number, dayWidth: number): number {
  return (day - rangeStart) * dayWidth;
}

/** Jour sous une abscisse de la grille. */
export function xToDay(x: number, rangeStart: number, dayWidth: number): number {
  return rangeStart + x / dayWidth;
}

// ---------- En-tête ----------

export interface MonthSegment {
  key: number;
  /** « octobre 2026 », « sept. » ou rien selon la place disponible (pas de libellé rogné) */
  label: string;
  width: number;
}

const fmtMonthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

export function monthSegments(range: Range, dayWidth: number): MonthSegment[] {
  const out: MonthSegment[] = [];
  let d = range.start;
  while (d <= range.end) {
    const first = startOfMonth(d);
    const next = startOfMonth(first + 32);
    const last = Math.min(next - 1, range.end);
    const width = (last - d + 1) * dayWidth;
    const full = formatMonth(first);
    const short = fmtMonthShort.format(new Date(first * 86_400_000));
    // ~7 px par caractère (12 px, graisse 600) + marges du libellé
    const label = width >= full.length * 7 + 16 ? full : width >= short.length * 7 + 16 ? short : '';
    out.push({ key: first, label, width });
    d = last + 1;
  }
  return out;
}

/** Jours (dans la plage) où commence un mois : traits verticaux plus marqués. */
export function monthStarts(range: Range): number[] {
  const out: number[] = [];
  let m = startOfMonth(range.start);
  if (m < range.start) m = startOfMonth(m + 32);
  while (m <= range.end) {
    out.push(m);
    m = startOfMonth(m + 32);
  }
  return out;
}

const INITIALS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export interface Tick {
  key: number;
  width: number;
  /** Texte principal (numéro du jour, date du lundi…) */
  main: string;
  /** Texte secondaire discret (initiale du jour, numéro de semaine) */
  sub: string;
  title: string;
  weekend: boolean;
  today: boolean;
}

export function ticks(range: Range, zoom: Zoom, dayWidth: number, todayDay: number): Tick[] {
  const out: Tick[] = [];
  if (zoom === 'day') {
    for (let d = range.start; d <= range.end; d++) {
      out.push({
        key: d,
        width: dayWidth,
        main: String(dayOfMonth(d)),
        sub: INITIALS[weekday(d)],
        title: formatLong(d),
        weekend: isWeekend(d),
        today: d === todayDay
      });
    }
    return out;
  }
  for (let d = range.start; d <= range.end; d += 7) {
    const week = isoWeek(d);
    out.push({
      key: d,
      width: 7 * dayWidth,
      main: zoom === 'week' ? formatShort(d) : String(dayOfMonth(d)),
      sub: zoom === 'week' ? `S${week}` : '',
      title: `Semaine ${week} · ${formatLong(d)}`,
      weekend: false,
      today: todayDay >= d && todayDay < d + 7
    });
  }
  return out;
}

// ---------- Lignes & groupes ----------

/**
 * Barre posée sur une ligne : la carte entière, ou la part d'un assigné (carte à plusieurs personnes).
 * Déplacer une part change la date de début de cette personne ; déplacer la carte, celle de la carte.
 */
export interface Segment {
  key: string;
  /** Assigné dont la date bouge quand on déplace la barre ; null = la date de la carte */
  userId: number | null;
  start: number;
  end: number;
  /** Jours ouvrés travaillés (pauses non comprises) : durée conservée quand on déplace la barre */
  workingDays: number;
  /** Pauses de la personne (ou communes à tous les assignés pour la barre de la carte), `[début, reprise)` fusionnées */
  pauses: PauseSpan[];
  /** Rangée dans la ligne (parts qui se chevauchent : empilées), de 0 à `lanes - 1` */
  lane: number;
}

export interface TimelineRow {
  /** Clé unique dans la vue (une carte peut apparaître dans plusieurs groupes « Assigné ») */
  key: string;
  card: Card;
  /** Étendue de la ligne (tri, étendue des groupes) */
  start: number;
  end: number;
  /** Part de la personne du groupe (regroupement par assigné), sinon null */
  pct: number | null;
  segments: Segment[];
  /** Une barre par assigné (avatar par barre) plutôt qu'une barre pour la carte */
  split: boolean;
  /** Nombre de rangées nécessaires pour que les parts ne se chevauchent pas */
  lanes: number;
  /** Personnes de la ligne en pause aujourd'hui (icône sur le libellé) ; vide sinon */
  paused: { userId: number; since: string }[];
}

export interface TimelineGroup {
  key: string;
  label: string;
  /** Couleur de l'état ou du projet */
  color: string | null;
  /** Personne (regroupement par assigné) ; null = « Non assigné » ou autre */
  userId: number | null;
  /** Code du projet (regroupement par projet) */
  code: string | null;
  /** Glyphe du type (regroupement par type) ; null = « Sans type » ou autre */
  icon: string | null;
  rows: TimelineRow[];
  /** Charge totale en j/h (part de la personne pour un groupe d'assigné) */
  load: number;
  spanStart: number | null;
  spanEnd: number | null;
}

function span(s: Schedule | null): { start: number; end: number; workingDays: number } | null {
  const a = toDay(s?.start);
  const b = toDay(s?.end);
  if (a == null || b == null || !s) return null;
  return { start: a, end: Math.max(a, b), workingDays: s.working_days };
}

/** Intersection de deux listes d'intervalles `[début, reprise)` triés et disjoints. */
function intersect(a: PauseSpan[], b: PauseSpan[]): PauseSpan[] {
  const out: PauseSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]);
    const end = Math.min(a[i][1], b[j][1]);
    if (start < end) out.push([start, end]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/** Pauses communes à tous les assignés (barre de la carte) : avec un seul assigné, les siennes. */
function commonPauses(assignees: Assignee[], todayDay: number): PauseSpan[] {
  if (!assignees.length) return [];
  return assignees.map((a) => pauseIntervals(a.pauses, todayDay)).reduce(intersect);
}

/** Personnes en pause aujourd'hui (pause en cours déjà commencée), avec leur premier jour de pause. */
function pausedNow(assignees: Assignee[], todayDay: number): { userId: number; since: string }[] {
  return assignees.flatMap((a) => {
    const p = openPause(a);
    const since = toDay(p?.start_date);
    return p && since != null && since <= todayDay ? [{ userId: a.user_id, since: p.start_date }] : [];
  });
}

/**
 * Ligne d'une carte. Plusieurs assignés : une part par personne, chacune à ses dates (empilées si elles se
 * chevauchent). Sinon une seule barre ; avec un seul assigné qui a sa propre date, la déplacer change cette date
 * (celle de la carte ne la ferait pas bouger). Avec un seul assigné, la barre de la carte est sa part : elle en
 * reprend les pauses et la durée travaillée (pour l'aperçu du glisser).
 */
function cardRow(card: Card, key: string, pct: number | null, todayDay: number): TimelineRow | null {
  const whole = span(card.schedule);
  if (!whole) return null;
  const paused = pausedNow(card.assignees, todayDay);
  if (card.assignees.length < 2) {
    const only = card.assignees[0];
    const userId = only?.start_date ? only.user_id : null;
    const workingDays = only?.schedule?.working_days ?? whole.workingDays;
    const segment: Segment = { key: 'card', userId, lane: 0, ...whole, workingDays, pauses: commonPauses(card.assignees, todayDay) };
    return { key, card, start: whole.start, end: whole.end, pct, segments: [segment], split: false, lanes: 1, paused };
  }
  const segments: Segment[] = [];
  for (const a of card.assignees) {
    const s = span(a.schedule);
    if (s) segments.push({ key: `a${a.user_id}`, userId: a.user_id, lane: 0, ...s, pauses: pauseIntervals(a.pauses, todayDay) });
  }
  if (!segments.length) return null;
  const lanes = assignLanes(segments);
  return { key, card, start: whole.start, end: whole.end, pct, segments, split: true, lanes, paused };
}

/** Ligne d'une personne (regroupement par assigné) pour une carte à plusieurs assignés : sa seule part. */
function personPart(card: Card, userId: number, key: string, todayDay: number): TimelineRow | null {
  const a = card.assignees.find((x) => x.user_id === userId);
  const s = a ? span(a.schedule) : null;
  if (!a || !s) return null;
  const segment: Segment = { key: `a${userId}`, userId, lane: 0, ...s, pauses: pauseIntervals(a.pauses, todayDay) };
  return { key, card, start: s.start, end: s.end, pct: a.pct, segments: [segment], split: false, lanes: 1, paused: pausedNow([a], todayDay) };
}

/** Rangées des parts (premier arrivé, première rangée libre) ; renvoie leur nombre. */
function assignLanes(segments: Segment[]): number {
  const ends: number[] = [];
  const order = [...segments].sort((a, b) => a.start - b.start || b.end - a.end || (a.userId ?? 0) - (b.userId ?? 0));
  for (const s of order) {
    let lane = ends.findIndex((e) => e < s.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = s.end;
    s.lane = lane;
  }
  return Math.max(1, ends.length);
}

/** Hauteur et position verticale (px) d'une barre dans une ligne de ROW_HEIGHT, selon sa rangée. */
export function laneBox(lane: number, lanes: number): { top: number; height: number } {
  if (lanes <= 1) return { top: 6, height: 24 };
  const gap = 2;
  const height = Math.max(4, Math.floor((26 - (lanes - 1) * gap) / lanes));
  const used = lanes * height + (lanes - 1) * gap;
  return { top: Math.round((ROW_HEIGHT - used) / 2) + lane * (height + gap), height };
}

function byStart(a: TimelineRow, b: TimelineRow): number {
  return a.start - b.start || a.end - b.end || a.card.priority - b.card.priority || a.card.id - b.card.id;
}

function makeGroup(
  key: string,
  label: string,
  rows: TimelineRow[],
  opts: { color?: string | null; userId?: number | null; code?: string | null; icon?: string | null } = {}
): TimelineGroup {
  rows.sort(byStart);
  let load = 0;
  let spanStart: number | null = null;
  let spanEnd: number | null = null;
  for (const r of rows) {
    load += (r.card.estimate_days ?? 0) * (r.pct == null ? 1 : r.pct / 100);
    if (spanStart == null || r.start < spanStart) spanStart = r.start;
    if (spanEnd == null || r.end > spanEnd) spanEnd = r.end;
  }
  return {
    key,
    label,
    color: opts.color ?? null,
    userId: opts.userId ?? null,
    code: opts.code ?? null,
    icon: opts.icon ?? null,
    rows,
    load,
    spanStart,
    spanEnd
  };
}

const collator = new Intl.Collator('fr', { sensitivity: 'base' });

/** Groupes de lignes planifiées (les cartes sans planification vont dans « Non planifiées »). */
export function buildGroups(
  cards: Card[],
  states: State[],
  members: Member[],
  projects: Project[],
  types: CardType[],
  groupBy: GroupBy,
  todayDay: number = today()
): TimelineGroup[] {
  const scheduledRow = (card: Card, key: string, pct: number | null) => cardRow(card, key, pct, todayDay);
  const personRow = (card: Card, userId: number, key: string) => personPart(card, userId, key, todayDay);
  if (groupBy === 'none') {
    const rows = cards.map((c) => scheduledRow(c, `c${c.id}`, null)).filter((r): r is TimelineRow => r != null);
    return rows.length ? [makeGroup('all', 'Toutes les cartes', rows)] : [];
  }

  if (groupBy === 'project') {
    // Un groupe par projet ayant des cartes planifiées, par nom ; projet inconnu (droits, suppression en cours) en dernier.
    const byProject = new Map<number, TimelineRow[]>();
    for (const c of cards) {
      const r = scheduledRow(c, `p${c.project_id}:${c.id}`, null);
      if (!r) continue;
      const list = byProject.get(c.project_id);
      if (list) list.push(r);
      else byProject.set(c.project_id, [r]);
    }
    const known = new Map(projects.map((p) => [p.id, p]));
    const groups: TimelineGroup[] = [];
    const orphans: TimelineRow[] = [];
    for (const [id, rows] of byProject) {
      const p = known.get(id);
      if (p) groups.push(makeGroup(`p${id}`, p.name, rows, { color: p.color, code: p.code }));
      else orphans.push(...rows);
    }
    groups.sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.code ?? '', b.code ?? ''));
    if (orphans.length) groups.push(makeGroup('p?', 'Projet inconnu', orphans));
    return groups;
  }

  if (groupBy === 'state') {
    const groups: TimelineGroup[] = [];
    const known = new Set(states.map((s) => s.id));
    for (const s of states) {
      const rows = cards
        .filter((c) => c.state_id === s.id)
        .map((c) => scheduledRow(c, `s${s.id}:${c.id}`, null))
        .filter((r): r is TimelineRow => r != null);
      if (rows.length) groups.push(makeGroup(`s${s.id}`, s.name, rows, { color: s.color }));
    }
    const orphans = cards
      .filter((c) => !known.has(c.state_id))
      .map((c) => scheduledRow(c, `s?:${c.id}`, null))
      .filter((r): r is TimelineRow => r != null);
    if (orphans.length) groups.push(makeGroup('s?', 'Sans état', orphans));
    return groups;
  }

  if (groupBy === 'type') {
    // Un groupe par type, dans l'ordre des types, puis « Sans type » (type absent ou inconnu).
    const groups: TimelineGroup[] = [];
    const known = new Set(types.map((t) => t.id));
    for (const t of types) {
      const rows = cards
        .filter((c) => c.type_id === t.id)
        .map((c) => scheduledRow(c, `t${t.id}:${c.id}`, null))
        .filter((r): r is TimelineRow => r != null);
      if (rows.length) groups.push(makeGroup(`t${t.id}`, t.name, rows, { icon: t.icon, color: glyphColor(t.icon) }));
    }
    const untyped = cards
      .filter((c) => c.type_id == null || !known.has(c.type_id))
      .map((c) => scheduledRow(c, `t-:${c.id}`, null))
      .filter((r): r is TimelineRow => r != null);
    if (untyped.length) groups.push(makeGroup('t-', 'Sans type', untyped));
    return groups;
  }

  // Par assigné : une carte à plusieurs personnes apparaît dans chacun de leurs groupes.
  const byUser = new Map<number, TimelineRow[]>();
  const unassigned: TimelineRow[] = [];
  for (const c of cards) {
    if (c.assignees.length === 0) {
      const r = scheduledRow(c, `u-:${c.id}`, null);
      if (r) unassigned.push(r);
      continue;
    }
    for (const a of c.assignees) {
      const key = `u${a.user_id}:${c.id}`;
      const r = c.assignees.length > 1 ? personRow(c, a.user_id, key) : scheduledRow(c, key, a.pct);
      if (!r) continue;
      const list = byUser.get(a.user_id);
      if (list) list.push(r);
      else byUser.set(a.user_id, [r]);
    }
  }
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const groups = [...byUser.entries()]
    .map(([userId, rows]) => makeGroup(`u${userId}`, names.get(userId) ?? 'Ancien membre', rows, { userId }))
    .sort((a, b) => collator.compare(a.label, b.label));
  if (unassigned.length) groups.push(makeGroup('u-', 'Non assigné', unassigned));
  return groups;
}

// ---------- Cartes non planifiées ----------

export interface UnplannedRow {
  card: Card;
  reason: string;
  /** Chiffrée mais sans date : « Planifier aujourd'hui » possible */
  canPlan: boolean;
}

export function unplannedReason(card: Card): string {
  const noStart = toDay(card.start_date) == null;
  const noEstimate = card.estimate_days == null || !(card.estimate_days > 0);
  if (noStart && noEstimate) return 'Ni date de début ni chiffrage';
  if (noStart) return 'Pas de date de début';
  if (noEstimate) return 'Pas de chiffrage';
  return 'Planification indisponible';
}

export function unplannedRows(cards: Card[], states: State[]): UnplannedRow[] {
  const order = new Map(states.map((s, i) => [s.id, i]));
  return cards
    .filter((c) => c.schedule == null)
    .sort(
      (a, b) =>
        (order.get(a.state_id) ?? 1e9) - (order.get(b.state_id) ?? 1e9) ||
        a.priority - b.priority ||
        a.position - b.position ||
        a.id - b.id
    )
    .map((card) => ({
      card,
      reason: unplannedReason(card),
      canPlan: card.estimate_days != null && card.estimate_days > 0 && toDay(card.start_date) == null
    }));
}

// ---------- Déplacements ----------

export function prevWorkingDay(day: number): number {
  while (isWeekend(day)) day -= 1;
  return day;
}

/** Recule de `n` jours ouvrés à partir d'un jour ouvré. */
export function subWorkingDays(start: number, n: number): number {
  let d = prevWorkingDay(start);
  for (let i = 0; i < n; i++) d = prevWorkingDay(d - 1);
  return d;
}

/**
 * Nouvelle planification si l'on décale le début de `delta` jours calendaires (début ramené au jour ouvré suivant) :
 * même nombre de jours travaillés, les pauses (fixes dans le calendrier) repoussant la fin.
 */
export function shiftSchedule(start: number, workingDays: number, delta: number, pauses: readonly PauseSpan[] = []): { start: number; end: number } {
  const { start: s, end } = planDays(start + delta, Math.max(workingDays, 1), pauses);
  return { start: s, end };
}

// ---------- Pauses (infobulle) ----------

/**
 * Pauses d'un assigné qui touchent `[start, end]` (sa planification), plus la pause en cours :
 * les anciennes, sans effet sur la planification, n'encombrent pas l'infobulle.
 */
export function relevantPauses(a: Assignee, start: number | null, end: number | null): Pause[] {
  return a.pauses.filter((p) => {
    if (p.end_date == null) return true;
    const ps = toDay(p.start_date);
    const pe = toDay(p.end_date);
    if (ps == null || pe == null) return false;
    return start == null || end == null || (ps <= end && pe - 1 >= start);
  });
}

// ---------- Formats ----------
// Nombres, charges (j/h), parts (%) et durées : $lib/format, communs au Kanban et à la chronologie.

const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const yearOf = (day: number) => new Date(day * 86_400_000).getUTCFullYear();

/** « lun. 5 oct. » */
export function formatDay(day: number): string {
  return fmtDay.format(new Date(day * 86_400_000));
}

/** « lun. 12 oct. → ven. 16 oct. » sans année (bulle de glisser) ; un seul jour si début = fin. */
export function formatDayRange(start: number, end: number): string {
  return start === end ? formatDay(start) : `${formatDay(start)} → ${formatDay(end)}`;
}

/** « lun. 5 oct. → ven. 9 oct. 2026 » (année répétée seulement si elle change ; un seul jour si début = fin). */
export function formatRange(start: number, end: number): string {
  if (start === end) return formatLong(start);
  if (yearOf(start) !== yearOf(end)) return `${formatLong(start)} → ${formatLong(end)}`;
  return `${formatDay(start)} → ${formatLong(end)}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

// ---------- Mesure de texte (titre dans ou hors de la barre) ----------

let ctx: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** Largeur approximative d'un titre de barre (12px, graisse 500), mise en cache. */
export function textWidth(text: string): number {
  const hit = widths.get(text);
  if (hit != null) return hit;
  if (ctx === undefined) {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    if (ctx) ctx.font = `500 12px ${getComputedStyle(document.body).fontFamily}`;
  }
  const w = ctx ? ctx.measureText(text).width : text.length * 6.6;
  if (widths.size > 2000) widths.clear();
  widths.set(text, w);
  return w;
}

// ---------- Préférences ----------

export const ZOOM_KEY = 'pm.timeline.zoom';
export const GROUP_KEY = 'pm.timeline.group';

export function readPref<T>(key: string, guard: (v: unknown) => v is T, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return guard(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : la préférence ne sera simplement pas retenue */
  }
}
