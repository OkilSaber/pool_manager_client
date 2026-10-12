/**
 * Attachement Svelte (`{@attach truncatedTitle}`) : infobulle native seulement quand le texte est
 * coupé par une ellipse. Un `title` qui répète un texte entièrement visible n'est que du bruit au survol.
 * La mesure se fait à l'entrée du pointeur : elle reste juste après un redimensionnement ou un
 * renommage, sans observer l'élément en continu.
 */
export function truncatedTitle(el: HTMLElement) {
  const update = () => {
    const text = el.textContent?.trim() ?? '';
    if (text && el.scrollWidth > el.clientWidth) el.title = text;
    else el.removeAttribute('title');
  };
  el.addEventListener('pointerenter', update);
  return () => el.removeEventListener('pointerenter', update);
}
