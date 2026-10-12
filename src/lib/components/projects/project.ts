// Outils partagés autour des projets : palette, code court, dernier projet utilisé.

/** Couleurs proposées pour un projet (format #rrggbb minuscule attendu par le serveur). */
export const PROJECT_COLORS: { value: string; name: string }[] = [
  { value: '#6366f1', name: 'Indigo' },
  { value: '#3b82f6', name: 'Bleu' },
  { value: '#06b6d4', name: 'Cyan' },
  { value: '#14b8a6', name: 'Turquoise' },
  { value: '#22c55e', name: 'Vert' },
  { value: '#eab308', name: 'Jaune' },
  { value: '#f97316', name: 'Orange' },
  { value: '#ef4444', name: 'Rouge' },
  { value: '#ec4899', name: 'Rose' },
  { value: '#8b5cf6', name: 'Violet' },
  { value: '#64748b', name: 'Ardoise' }
];

/** Code valide : 2 à 6 lettres ou chiffres en majuscules, commençant par une lettre. */
export const CODE_RE = /^[A-Z][A-Z0-9]{1,5}$/;

/** Saisie normalisée : majuscules, sans accents ni caractères hors [A-Z0-9], 6 au plus. */
export function normalizeCode(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/**
 * Code suggéré à partir du nom : initiales des mots (« Site vitrine » → SV) ; un seul mot :
 * ses premières lettres (« Marketing » → MARK). Vide si le nom ne contient aucune lettre.
 */
export function suggestCode(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const first = words.findIndex((w) => /^[A-Z]/.test(w));
  if (first < 0) return '';
  const rest = words.slice(first);
  const code = rest.length === 1 ? rest[0].slice(0, 4) : rest.map((w) => w[0]).join('').slice(0, 6);
  // Un mot d'une lettre (« Q ») ou des initiales trop courtes : on complète avec le premier mot.
  return code.length >= 2 ? code : normalizeCode(rest[0]).slice(0, 4).padEnd(2, 'X');
}

/** Couleur par défaut d'un nouveau projet : la première pas encore prise. */
export function nextProjectColor(taken: string[]): string {
  const used = new Set(taken.map((c) => c.toLowerCase()));
  return (PROJECT_COLORS.find((c) => !used.has(c.value)) ?? PROJECT_COLORS[taken.length % PROJECT_COLORS.length]).value;
}

const LAST_KEY = (poolId: number) => `pm.lastProject.pool.${poolId}`;

/** Dernier projet choisi pour créer une carte dans un pool. */
export function lastProject(poolId: number): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_KEY(poolId)));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function rememberProject(poolId: number, projectId: number) {
  try {
    localStorage.setItem(LAST_KEY(poolId), String(projectId));
  } catch {
    /* stockage indisponible : simple confort perdu */
  }
}
