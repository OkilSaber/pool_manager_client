import { goto } from '$app/navigation';
import { api, getToken, setToken, setUnauthorizedHandler } from '$lib/api';
import type { User } from '$lib/types/User';
import { board } from './board.svelte';

class Session {
  user = $state<User | null>(null);
  /** Faux tant que la session stockée n'a pas été vérifiée auprès du serveur. */
  ready = $state(false);

  async init() {
    setUnauthorizedHandler((token) => this.expire(token));
    if (getToken()) {
      try {
        this.user = await api.me();
      } catch {
        // Serveur injoignable ou token expiré : retour à l'écran de connexion.
        this.user = null;
      }
    }
    this.ready = true;
  }

  async login(email: string, password: string) {
    const res = await api.login(email, password);
    setToken(res.token);
    this.user = res.user;
  }

  async signup(email: string, displayName: string, password: string) {
    const res = await api.signup(email, displayName, password);
    setToken(res.token);
    this.user = res.user;
  }

  /**
   * Fin de session locale : jeton, utilisateur et tableau ouvert (dont les identifiants n'ont de sens que pour
   * ce compte et ce serveur). La garde du layout renvoie ensuite vers /login.
   */
  clear() {
    setToken(null);
    board.reset();
    this.user = null;
  }

  /**
   * Déconnexion immédiate côté client ; la révocation du jeton part en arrière-plan (elle emporte le jeton,
   * lu avant le premier `await`) : un serveur qui ne répond pas ne bloque pas « Se déconnecter ».
   */
  async logout() {
    api.logout().catch(() => {
      /* déjà déconnecté côté serveur, ou serveur injoignable */
    });
    this.clear();
    await goto('/login');
  }

  /** 401 : seulement si la requête portait le jeton courant (pas une réponse tardive d'une session précédente). */
  private expire(token: string) {
    if (getToken() !== token) return;
    this.clear();
  }
}

export const session = new Session();
