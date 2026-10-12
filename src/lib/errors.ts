/**
 * Message d'erreur affichable. Le serveur répond en minuscules (« email ou mot de passe incorrect »,
 * « introuvable ») : on met une majuscule initiale pour un message qui se lit comme une phrase.
 */
export function errorMessage(e: unknown): string {
  const message = (e instanceof Error ? e.message : String(e)).trim();
  return message.charAt(0).toUpperCase() + message.slice(1);
}
