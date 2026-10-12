// État partagé du glisser-déposer des cartes entre colonnes, et réglages globaux de svelte-dnd-action.

import { setAriaStrings, setKeyboardDragTrigger } from 'svelte-dnd-action';

/**
 * Vrai pendant qu'une carte est en cours de déplacement : chaque colonne garde alors sa liste locale
 * (avec l'emplacement fantôme) au lieu de se resynchroniser sur le store.
 */
export const cardDrag = $state({ active: false, keyboard: false });

let configured = false;

/** Annonces lecteur d'écran en français ; Espace déplace au clavier, Entrée reste libre pour ouvrir. */
export function configureDnd() {
  if (configured) return;
  configured = true;
  setKeyboardDragTrigger('space');
  setAriaStrings({
    dragStarted: ({ itemLabel, zoneLabel, canMoveBetweenZones }) =>
      `Déplacement de « ${itemLabel} ». Flèches pour le déplacer dans ${zoneLabel}` +
      (canMoveBetweenZones ? ', Tab pour changer de colonne' : '') +
      '. Espace ou Échap pour déposer.',
    movedToPosition: ({ itemLabel, zoneLabel, position, count }) =>
      `« ${itemLabel} » en position ${position} sur ${count} dans ${zoneLabel}`,
    movedToZoneEnd: ({ itemLabel, zoneLabel }) => `« ${itemLabel} » déplacé à la fin de ${zoneLabel}`,
    movedToZoneStart: ({ itemLabel, zoneLabel }) => `« ${itemLabel} » déplacé au début de ${zoneLabel}`,
    dropped: ({ itemLabel, zoneLabel, position }) => `« ${itemLabel} » déposé en position ${position} dans ${zoneLabel}`,
    zoneActiveInstruction: 'Tabulez jusqu’à un élément puis appuyez sur Espace pour le déplacer.',
    zoneDragDisabledInstruction: 'Liste non déplaçable.'
  });
}

/** Au relâchement, l'élément glissé « se pose » (rotation et ombre retombent pendant l'animation de dépôt). */
export function markDropping() {
  document.getElementById('dnd-action-dragged-el')?.setAttribute('data-dropping', '');
}
