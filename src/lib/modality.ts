// Dernière modalité d'entrée (clavier ou pointeur).
// Sert à ne jamais animer ce qui est déclenché au clavier : menus, onglets, etc. s'affichent instantanément.

let keyboard = false;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) keyboard = true;
    },
    true
  );
  window.addEventListener('pointerdown', () => (keyboard = false), true);
}

export function lastInputWasKeyboard(): boolean {
  return keyboard;
}
