// Dernière liste de pools connue (par serveur et par utilisateur — les identifiants se recoupent d'un
// serveur à l'autre) : revenir à l'accueil est instantané, puis la page revalide.
// Les changements faits ailleurs (renommage, départ d'un pool) y sont reportés tout de suite,
// pour qu'aucune entrée périmée ne s'affiche le temps de la revalidation.

import type { Pool } from '$lib/types/Pool';

let cache: { key: string; pools: Pool[] } | null = null;

export const poolsCache = {
  get(key: string): Pool[] | null {
    return cache?.key === key ? cache.pools : null;
  },

  set(key: string, pools: Pool[]) {
    cache = { key, pools };
  },

  /** Applique une modification connue à la liste en cache, quelle que soit sa clé. */
  update(fn: (pools: Pool[]) => Pool[]) {
    if (cache) cache = { key: cache.key, pools: fn(cache.pools) };
  }
};
