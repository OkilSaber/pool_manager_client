/** Initiales (2 lettres max) d'un nom affiché. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Teinte stable dérivée de l'identifiant (répartie par le nombre d'or pour éviter les voisins proches). */
export function hue(id: number): number {
  return Math.round((id * 137.508) % 360);
}
