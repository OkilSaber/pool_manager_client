// Dernière liste de tableaux connue (par serveur et par utilisateur — les identifiants se recoupent d'un
// serveur à l'autre) : revenir à la liste est instantané, puis la page revalide.
// Les changements faits ailleurs (renommage, départ d'un tableau) y sont reportés tout de suite,
// pour qu'aucune entrée périmée ne s'affiche le temps de la revalidation.

import type { Board } from '$lib/types/Board';

let cache: { key: string; boards: Board[] } | null = null;

export const boardsCache = {
  get(key: string): Board[] | null {
    return cache?.key === key ? cache.boards : null;
  },

  set(key: string, boards: Board[]) {
    cache = { key, boards };
  },

  /** Applique une modification connue à la liste en cache, quelle que soit sa clé. */
  update(fn: (boards: Board[]) => Board[]) {
    if (cache) cache = { key: cache.key, boards: fn(cache.boards) };
  }
};
