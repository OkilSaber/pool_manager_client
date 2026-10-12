// Dates « calendaires » YYYY-MM-DD manipulées en jours depuis l'epoch (UTC) : pas de piège de fuseau ni d'heure d'été.
// Miroir TypeScript de crates/shared/src/schedule.rs (utilisé pour les mises à jour optimistes et l'aperçu de drag).

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

export function addWorkingDays(start: number, n: number): number {
  let d = nextWorkingDay(start);
  for (let i = 0; i < n; i++) d = nextWorkingDay(d + 1);
  return d;
}

/** Durée en jours ouvrés : plus grosse part de charge (chacun en parallèle), au moins 1. */
export function workingDays(estimateDays: number | null | undefined, pcts: number[]): number | null {
  if (estimateDays == null || !Number.isFinite(estimateDays) || estimateDays <= 0) return null;
  const share = pcts.length ? Math.max(...pcts) / 100 : 1;
  const days = Math.ceil(Math.round(estimateDays * share * 1e9) / 1e9);
  return Math.max(days, 1);
}

export function computeSchedule(
  startDate: string | null | undefined,
  estimateDays: number | null | undefined,
  pcts: number[]
): Schedule | null {
  const raw = toDay(startDate);
  const days = workingDays(estimateDays, pcts);
  if (raw == null || days == null) return null;
  const start = nextWorkingDay(raw);
  return { start: fromDay(start), end: fromDay(addWorkingDays(start, days - 1)), working_days: days };
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
