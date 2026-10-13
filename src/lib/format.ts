// Formats d'affichage communs au Kanban, à la modale de carte et à la chronologie
// (français : virgule décimale, espaces insécables avant « % », « j/h » et « : »).

const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Espace fine insécable, utilisée avant « % ». */
export const NNBSP = ' ';

export function fmtNum(n: number): string {
  return num.format(n);
}

/** « 3 j/h », « 2,5 j/h » */
export function fmtEstimate(n: number): string {
  return `${fmtNum(n)}${NNBSP}j/h`;
}

/** « 60 % » */
export function fmtPct(n: number): string {
  return `${fmtNum(n)}${NNBSP}%`;
}

/** « 1 j ouvré », « 5 j ouvrés » */
export function fmtWorkingDays(n: number): string {
  return `${n}${NNBSP}j ouvré${n > 1 ? 's' : ''}`;
}

const created = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Horodatage serveur (ISO) → « 5 oct. 2026 » dans le fuseau local. */
export function fmtCreated(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : created.format(d);
}

/** Saisie libre d'un chiffrage (« 2,5 », « 3 ») → nombre ≥ 0, null si vide, undefined si invalide. */
export function parseEstimate(raw: string): number | null | undefined {
  // Espaces (y compris insécables, ex. « 1 000 » copié d'un affichage) ignorés.
  const s = raw.replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

const fmtFull = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
const fmtDayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtDayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Horodatage serveur (ISO, UTC) → « lundi 12 octobre 2026 à 14:05 » dans le fuseau local. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmtFull.format(d);
}

/**
 * Horodatage serveur → date relative : « à l'instant », « il y a 5 min », « il y a 3 h » (même jour),
 * « hier », puis « 12 oct. » (« 12 oct. 2025 » une autre année). `now` : horloge de référence (ms).
 */
export function fmtRelative(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return 'à l’instant'; // horloge locale un peu en retard sur le serveur : pas de « dans 1 min »
  if (minutes < 60) return `il y a ${minutes}${NNBSP}min`;
  const ref = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, ref)) return `il y a ${Math.floor(minutes / 60)}${NNBSP}h`;
  const yesterday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1);
  if (sameDay(d, yesterday)) return 'hier';
  return d.getFullYear() === ref.getFullYear() ? fmtDayMonth.format(d) : fmtDayMonthYear.format(d);
}
