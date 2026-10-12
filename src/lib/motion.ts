// Paramètres de mouvement partagés pour les transitions Svelte (in:/out:/animate:).
// Les transitions Svelte compilent en animations CSS : elles tournent hors du thread principal.
import { cubicOut, quintOut } from 'svelte/easing';

/** ≈ cubic-bezier(0.23, 1, 0.32, 1) — ease-out fort pour les entrées */
export const easeOut = quintOut;
/** ease-out plus doux pour les sorties courtes */
export const easeOutSoft = cubicOut;

export const DUR = {
  press: 140,
  pop: 180,
  modal: 220,
  exit: 130,
  flip: 200
} as const;

/** Vrai si l'utilisateur a demandé moins de mouvement : garder les fondus, supprimer les déplacements. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
