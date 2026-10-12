// Textarea qui grandit avec son contenu. Passer la valeur courante pour recalculer
// aussi après une mise à jour programmatique : `{@attach autosize(value)}`.

import type { Attachment } from 'svelte/attachments';

export function autosize(_value: string, max = 480): Attachment<HTMLTextAreaElement> {
  return (node) => {
    let width = -1;

    function fit() {
      if (!node.isConnected || node.offsetParent === null) return; // pas encore affiché (modale en ouverture)
      node.style.height = 'auto';
      const h = node.scrollHeight + 2;
      node.style.height = `${Math.min(h, max)}px`;
      node.style.overflowY = h > max ? 'auto' : 'hidden';
    }

    // Recalcule quand la largeur change (retour à la ligne) ou quand l'élément devient visible.
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w !== width) {
        width = w;
        fit();
      }
    });
    ro.observe(node);
    fit();
    node.addEventListener('input', fit);
    return () => {
      ro.disconnect();
      node.removeEventListener('input', fit);
    };
  };
}
