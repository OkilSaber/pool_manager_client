// Dates « calendaires » YYYY-MM-DD manipulées en jours depuis l'epoch (UTC) : pas de piège de fuseau ni d'heure d'été.
// Miroir TypeScript de server/crates/shared/src/schedule.rs (utilisé pour les mises à jour optimistes et l'aperçu de drag).

import type { Assignee } from './types/Assignee';
import type { Card } from './types/Card';
import type { Pause } from './types/Pause';
import type { Schedule } from './types/Schedule';

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` → jour epoch, ou null si invalide. */
export function toDay(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t / MS_PER_DAY;
}

/** Jour epoch → `YYYY-MM-DD`. */
export function fromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function today(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY;
}

/** 0 = dimanche … 6 = samedi (le 1er janvier 1970 était un jeudi). */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function isWeekend(day: number): boolean {
  const w = weekday(day);
  return w === 0 || w === 6;
}

export function nextWorkingDay(day: number): number {
  while (isWeekend(day)) day += 1;
  return day;
}

/** Avance de `n` jours ouvrés à partir du premier jour ouvré à partir de `start` (en temps constant, comme le serveur). */
export function addWorkingDays(start: number, n: number): number {
  let d = nextWorkingDay(start) + Math.floor(n / 5) * 7;
  for (let i = 0; i < n % 5; i++) d = nextWorkingDay(d + 1);
  return d;
}

/** Nombre de jours ouvrés de `start` à `end` inclus (0 si `end < start`). */
export function countWorkingDays(start: number, end: number): number {
  if (end < start) return 0;
  const weeks = Math.floor((end - start) / 7);
  let count = weeks * 5;
  for (let d = start + weeks * 7; d <= end; d++) if (!isWeekend(d)) count++;
  return count;
}

/** Durée maximale calculée par le serveur ; au-delà, pas de planification. */
export const MAX_WORKING_DAYS = 100_000;

/** Occupation par défaut (% du temps de la personne consacré à la carte ; entier 1–100). */
export const DEFAULT_OCCUPANCY = 100;

/**
 * Durée en jours ouvrés (au moins 1) d'une part de charge :
 * `ceil(chiffrage × pct / 100 × 100 / occupation)`, arrondi à 1e-9 près (10 × 0.7 = 7.000000000000001 ne donne pas 8).
 * Null sans chiffrage, avec une part ou une occupation hors bornes, ou au-delà de MAX_WORKING_DAYS.
 */
export function workingDays(estimateDays: number | null | undefined, pct = 100, occupancy = DEFAULT_OCCUPANCY): number | null {
  if (estimateDays == null || !Number.isFinite(estimateDays) || estimateDays <= 0) return null;
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  if (!Number.isInteger(occupancy) || occupancy < 1 || occupancy > 100) return null;
  const load = estimateDays * (pct / 100) * (100 / occupancy);
  const days = Math.ceil(Math.round(load * 1e9) / 1e9);
  if (!(days <= MAX_WORKING_DAYS)) return null;
  return Math.max(days, 1);
}

/** Année 1..=9999, comme le serveur (au-delà, la date ne s'écrit plus en AAAA-MM-JJ). */
function inCalendar(day: number): boolean {
  const y = new Date(day * MS_PER_DAY).getUTCFullYear();
  return y >= 1 && y <= 9999;
}

/** Intervalle de pause en jours epoch : `[début, reprise)`. */
export type PauseSpan = [start: number, end: number];

/**
 * Intervalles `[début, reprise)` des pauses, triés et fusionnés (chevauchants ou contigus).
 * Une pause en cours dure jusqu'à `todayDay` inclus, et au moins son premier jour (pause qui commence demain).
 * Une pause aux dates illisibles ou vide (reprise ≤ début) est ignorée : le serveur ne les enregistre pas.
 */
export function pauseIntervals(pauses: readonly Pause[] | null | undefined, todayDay: number = today()): PauseSpan[] {
  const spans: PauseSpan[] = [];
  for (const p of pauses ?? []) {
    const start = toDay(p.start_date);
    if (start == null) continue;
    const end = p.end_date == null ? Math.max(todayDay, start) + 1 : toDay(p.end_date);
    if (end != null && end > start) spans.push([start, end]);
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: PauseSpan[] = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * `days` jours ouvrés travaillés à partir du premier jour ouvré à partir de `raw`, en sautant les jours ouvrés
 * des pauses (triées et fusionnées) ; en temps constant par pause, comme le serveur. `start` reste le début prévu
 * même si une pause le couvre ; `paused` = jours ouvrés de pause entre le début et la fin.
 */
export function planDays(raw: number, days: number, pauses: readonly PauseSpan[] = []): { start: number; end: number; paused: number } {
  const start = nextWorkingDay(raw);
  let remaining = days;
  let cursor = start;
  let paused = 0;
  for (const [ps, pe] of pauses) {
    if (pe <= cursor) continue;
    if (ps > cursor) {
      const available = countWorkingDays(cursor, ps - 1);
      if (remaining <= available) break;
      remaining -= available;
      cursor = ps;
    }
    // Le curseur est dans la pause : ses jours ouvrés restants sont des jours de pause.
    paused += countWorkingDays(cursor, pe - 1);
    cursor = nextWorkingDay(pe);
  }
  return { start, end: addWorkingDays(cursor, remaining - 1), paused };
}

/** `days` jours ouvrés travaillés à partir du premier jour ouvré à partir de `raw`, pauses sautées. */
function span(raw: number | null, days: number | null, pauses: readonly PauseSpan[] = []): Schedule | null {
  if (raw == null || days == null || !inCalendar(raw)) return null;
  const { start, end, paused } = planDays(raw, days, pauses);
  if (!inCalendar(start) || !inCalendar(end)) return null;
  return { start: fromDay(start), end: fromDay(end), working_days: days, paused_days: paused };
}

/** Planification d'une carte sans assigné : tout le chiffrage à partir de sa date de début. */
export function computeSchedule(startDate: string | null | undefined, estimateDays: number | null | undefined): Schedule | null {
  return span(toDay(startDate), workingDays(estimateDays));
}

/**
 * Planification d'un assigné : sa part du chiffrage, étalée selon son occupation,
 * à partir de sa propre date de début ou, à défaut, de celle de la carte, en sautant ses pauses
 * (une pause en cours dure jusqu'à aujourd'hui inclus).
 */
export function assigneeSchedule(
  cardStart: string | null | undefined,
  ownStart: string | null | undefined,
  estimateDays: number | null | undefined,
  pct: number,
  occupancy: number = DEFAULT_OCCUPANCY,
  pauses: readonly Pause[] = [],
  todayDay: number = today()
): Schedule | null {
  return span(toDay(ownStart || cardStart), workingDays(estimateDays, pct, occupancy), pauseIntervals(pauses, todayDay));
}

/**
 * Planification agrégée d'une carte : sans assigné, comme `computeSchedule` ; avec assignés, du plus tôt
 * de leurs débuts à la plus tardive de leurs fins (null si aucun n'est planifié), pauses comprises dans
 * `working_days` (`paused_days` reste 0 : les pauses sont détaillées par assigné).
 */
export function cardSchedule(
  cardStart: string | null | undefined,
  estimateDays: number | null | undefined,
  assignees: (Schedule | null)[]
): Schedule | null {
  if (assignees.length === 0) return computeSchedule(cardStart, estimateDays);
  let lo: number | null = null;
  let hi: number | null = null;
  for (const s of assignees) {
    const a = toDay(s?.start);
    const b = toDay(s?.end);
    if (a != null && (lo == null || a < lo)) lo = a;
    if (b != null && (hi == null || b > hi)) hi = b;
  }
  if (lo == null || hi == null) return null;
  return { start: fromDay(lo), end: fromDay(hi), working_days: countWorkingDays(lo, hi), paused_days: 0 };
}

/** Pause en cours d'un assigné (la dernière, sans reprise), sinon null. */
export function openPause(a: Pick<Assignee, 'pauses'>): Pause | null {
  const last = a.pauses.at(-1);
  return last && last.end_date == null ? last : null;
}

/**
 * Jours (calendaires, inclus) de `[start, end]` couverts par des pauses : morceaux `{ start, end }` à hachurer
 * sur la chronologie (une pause en cours, jusqu'à aujourd'hui inclus).
 */
export function pausedRanges(start: number, end: number, pauses: readonly PauseSpan[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const [ps, pe] of pauses) {
    const a = Math.max(ps, start);
    const b = Math.min(pe - 1, end);
    if (a <= b) out.push({ start: a, end: b });
  }
  return out;
}

/** Ordre des assignés renvoyé par le serveur : part décroissante, puis id. */
export function byShare(a: { pct: number; user_id: number }, b: { pct: number; user_id: number }): number {
  return b.pct - a.pct || a.user_id - b.user_id;
}

/** Carte avec les planifications (de chaque assigné, pauses comprises, et agrégée) recalculées : miroir des mises à jour optimistes. */
export function withSchedules(card: Card): Card {
  const now = today();
  const assignees = card.assignees.map((a) => ({
    ...a,
    schedule: assigneeSchedule(card.start_date, a.start_date, card.estimate_days, a.pct, a.occupancy, a.pauses, now)
  }));
  return {
    ...card,
    assignees,
    schedule: cardSchedule(
      card.start_date,
      card.estimate_days,
      assignees.map((a) => a.schedule)
    )
  };
}

const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** « 5 oct. » */
export function formatShort(day: number): string {
  return fmtShort.format(new Date(day * MS_PER_DAY));
}

/** Libellé d'une pause : « En pause depuis le 12 oct. », « En pause le 12 oct. », « En pause du 12 au 15 oct. ». */
export function formatPause(p: Pause): string {
  const start = toDay(p.start_date);
  if (start == null) return 'En pause';
  const end = toDay(p.end_date);
  if (end == null) return `En pause depuis le ${formatShort(start)}`;
  // Dernier jour ouvré non travaillé (la reprise est exclue) : une pause du vendredi au lundi s'arrête vendredi.
  let last = end - 1;
  while (last > start && isWeekend(last)) last -= 1;
  if (last <= start) return `En pause le ${formatShort(start)}`;
  const sameMonth = p.start_date.slice(0, 7) === fromDay(last).slice(0, 7);
  return `En pause du ${sameMonth ? dayOfMonth(start) : formatShort(start)} au ${formatShort(last)}`;
}

/** « lun. 5 oct. 2026 » */
export function formatLong(day: number): string {
  return fmtLong.format(new Date(day * MS_PER_DAY));
}

/** « octobre 2026 » */
export function formatMonth(day: number): string {
  return fmtMonth.format(new Date(day * MS_PER_DAY));
}

/** Jour du mois (1-31) et premier jour du mois contenant `day`. */
export function dayOfMonth(day: number): number {
  return new Date(day * MS_PER_DAY).getUTCDate();
}

export function startOfMonth(day: number): number {
  const d = new Date(day * MS_PER_DAY);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / MS_PER_DAY;
}

/** Lundi de la semaine contenant `day`. */
export function startOfWeek(day: number): number {
  return day - ((weekday(day) + 6) % 7);
}

/** Numéro de semaine ISO 8601. */
export function isoWeek(day: number): number {
  const thursday = startOfWeek(day) + 3;
  const d = new Date(thursday * MS_PER_DAY);
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1) / MS_PER_DAY;
  return Math.floor((thursday - jan1) / 7) + 1;
}
