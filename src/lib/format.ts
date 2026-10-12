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
