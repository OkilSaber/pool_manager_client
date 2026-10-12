export interface PriorityInfo {
  value: number;
  label: string;
  name: string;
  /** Variable CSS de la couleur (définie dans app.css) */
  color: string;
}

export const PRIORITIES: PriorityInfo[] = [
  { value: 0, label: 'P0', name: 'Critique', color: 'var(--p0)' },
  { value: 1, label: 'P1', name: 'Haute', color: 'var(--p1)' },
  { value: 2, label: 'P2', name: 'Moyenne', color: 'var(--p2)' },
  { value: 3, label: 'P3', name: 'Basse', color: 'var(--p3)' },
  { value: 4, label: 'P4', name: 'Minime', color: 'var(--p4)' }
];

export function priority(value: number): PriorityInfo {
  return PRIORITIES[Math.min(Math.max(Math.round(value), 0), 4)];
}
