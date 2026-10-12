// Types de cartes : noms lisibles des glyphes (infobulles du sélecteur) et glyphe proposé pour un nouveau type.
import { ICONS, type Icon } from './types/icons';

export const ICON_LABELS: Record<Icon, string> = {
  feature: 'Fonctionnalité',
  bug: 'Bogue',
  doc: 'Documentation',
  maintenance: 'Maintenance',
  build: 'Build',
  task: 'Tâche',
  story: 'Récit utilisateur',
  improvement: 'Amélioration',
  epic: 'Épopée',
  test: 'Test',
  security: 'Sécurité',
  design: 'Design',
  research: 'Recherche',
  support: 'Support',
  infra: 'Infrastructure',
  release: 'Livraison',
  question: 'Question',
  data: 'Données',
  performance: 'Performance',
  chore: 'Corvée'
};

export function isIcon(v: string): v is Icon {
  return (ICONS as readonly string[]).includes(v);
}

export function iconLabel(icon: string): string {
  return isIcon(icon) ? ICON_LABELS[icon] : icon;
}

/** Premier glyphe pas encore utilisé par un type (sinon on reboucle). */
export function suggestIcon(used: string[]): Icon {
  const taken = new Set(used);
  return ICONS.find((i) => !taken.has(i)) ?? ICONS[used.length % ICONS.length];
}

/** Valeur du filtre par type désignant les cartes sans type. */
export const NO_TYPE = -1;
