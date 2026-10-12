// Dates « calendaires » YYYY-MM-DD manipulées en jours depuis l'epoch (UTC) : pas de piège de fuseau ni d'heure d'été.
// Miroir TypeScript de server/crates/shared/src/schedule.rs (utilisé pour les mises à jour optimistes et l'aperçu de drag).

import type { Card } from './types/Card';
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

/** `days` jours ouvrés à partir du premier jour ouvré à partir de `raw`. */
function span(raw: number | null, days: number | null): Schedule | null {
  if (raw == null || days == null || !inCalendar(raw)) return null;
  const start = nextWorkingDay(raw);
  const end = addWorkingDays(start, days - 1);
  if (!inCalendar(start) || !inCalendar(end)) return null;
  return { start: fromDay(start), end: fromDay(end), working_days: days };
}

/** Planification d'une carte sans assigné : tout le chiffrage à partir de sa date de début. */
export function computeSchedule(startDate: string | null | undefined, estimateDays: number | null | undefined): Schedule | null {
  return span(toDay(startDate), workingDays(estimateDays));
}

/**
 * Planification d'un assigné : sa part du chiffrage, étalée selon son occupation,
 * à partir de sa propre date de début ou, à défaut, de celle de la carte.
 */
export function assigneeSchedule(
  cardStart: string | null | undefined,
  ownStart: string | null | undefined,
  estimateDays: number | null | undefined,
  pct: number,
  occupancy: number = DEFAULT_OCCUPANCY
): Schedule | null {
  return span(toDay(ownStart || cardStart), workingDays(estimateDays, pct, occupancy));
}

/**
 * Planification agrégée d'une carte : sans assigné, comme `computeSchedule` ; avec assignés, du plus tôt
 * de leurs débuts à la plus tardive de leurs fins (null si aucun n'est planifié).
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
  return { start: fromDay(lo), end: fromDay(hi), working_days: countWorkingDays(lo, hi) };
}

/** Ordre des assignés renvoyé par le serveur : part décroissante, puis id. */
export function byShare(a: { pct: number; user_id: number }, b: { pct: number; user_id: number }): number {
  return b.pct - a.pct || a.user_id - b.user_id;
}

/** Carte avec les planifications (de chaque assigné et agrégée) recalculées : miroir des mises à jour optimistes. */
export function withSchedules(card: Card): Card {
  const assignees = card.assignees.map((a) => ({
    ...a,
    schedule: assigneeSchedule(card.start_date, a.start_date, card.estimate_days, a.pct, a.occupancy)
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
