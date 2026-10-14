// Temps réel : une WebSocket vers le serveur (`GET /api/ws`) qui prévient quand le tableau ouvert change.
// Le message ne transporte pas les données : on recharge le tableau (`board.sync()`), ou la liste des
// commentaires de la fiche ouverte. Nos propres écritures ne nous reviennent pas (`CLIENT_ID`).
//
// Connexion tant qu'une session existe (branchée par le layout), abonnement au tableau affiché (branché par
// la page du tableau), reconnexion avec attente croissante (1 s → 30 s). Les événements manqués pendant une
// coupure ne sont pas rejoués : chaque (ré)abonnement accepté recharge le tableau, comme le retour de la
// fenêtre au premier plan.

import { goto } from '$app/navigation';
import { SvelteMap } from 'svelte/reactivity';
import { api, CLIENT_ID, getServerUrl, getToken } from '$lib/api';
import { openSocket, type Socket } from '$lib/socket';
import type { WsClientMessage } from '$lib/types/WsClientMessage';
import type { WsScope } from '$lib/types/WsScope';
import type { WsServerMessage } from '$lib/types/WsServerMessage';
import { board } from './board.svelte';
import { toast } from './toast.svelte';

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Coupure plus longue que ce délai : l'en-tête du tableau affiche « Hors ligne ». */
const OFFLINE_AFTER_MS = 5_000;

const sameScope = (a: WsScope | null, b: WsScope | null) => a?.kind === b?.kind && a?.id === b?.id;

/** `http://hôte:port` → `ws://hôte:port/api/ws` (`https` → `wss`). */
function wsUrl(server: string): string {
  return `${server.replace(/^http/, 'ws')}/api/ws`;
}

class Realtime {
  /** Connexion ouverte (authentification envoyée). */
  online = $state(false);
  /** Déconnecté depuis plus de 5 s alors qu'une session existe : rien à l'écran tant que ça va. */
  offline = $state(false);
  /** Commentaires modifiés par un autre membre, par carte : compteur suivi par la fiche ouverte. */
  private commentTicks = new SvelteMap<number, number>();

  /** Session ouverte : on veut être connecté. */
  private active = false;
  /** Session refusée par le serveur (401) : pas de reconnexion, l'API REST fermera la session. */
  private denied = false;
  private socket: Socket | null = null;
  /** Tableau suivi (celui affiché), envoyé à chaque (re)connexion. */
  private scope: WsScope | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private offlineTimer: ReturnType<typeof setTimeout> | undefined;

  /** Nombre de notifications « commentaires » reçues pour une carte (lu dans un `$effect`). */
  commentChanges(cardId: number): number {
    return this.commentTicks.get(cardId) ?? 0;
  }

  /** Session ouverte : connexion (et reconnexions) jusqu'à `stop()`. */
  start() {
    if (this.active) return;
    this.active = true;
    this.denied = false;
    this.attempt = 0;
    document.addEventListener('visibilitychange', this.onvisible);
    window.addEventListener('focus', this.onvisible);
    this.connect();
  }

  /** Déconnexion, changement de serveur : on coupe tout, sans indicateur. */
  stop() {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onvisible);
    window.removeEventListener('focus', this.onvisible);
    clearTimeout(this.retryTimer);
    clearTimeout(this.offlineTimer);
    this.offlineTimer = undefined;
    this.socket?.close();
    this.socket = null;
    this.online = false;
    this.offline = false;
    this.commentTicks.clear();
  }

  /** Suit un tableau (ou plus aucun : `null`) ; remplace l'abonnement précédent. */
  watch(scope: WsScope | null) {
    const next = scope ? { kind: scope.kind, id: scope.id } : null;
    if (sameScope(this.scope, next)) return;
    this.scope = next;
    if (this.online) this.send(next ? { type: 'subscribe', scope: next } : { type: 'unsubscribe' });
  }

  private send(msg: WsClientMessage) {
    this.socket?.send(JSON.stringify(msg));
  }

  private connect() {
    clearTimeout(this.retryTimer);
    const token = getToken();
    if (!this.active || this.denied || this.socket || !token) return;
    this.armOffline();
    const socket = openSocket(wsUrl(getServerUrl()), {
      onopen: () => {
        this.attempt = 0;
        this.send({ type: 'auth', token, client_id: CLIENT_ID });
        if (this.scope) this.send({ type: 'subscribe', scope: this.scope });
        this.online = true;
        clearTimeout(this.offlineTimer);
        this.offlineTimer = undefined;
        this.offline = false;
      },
      onmessage: (text) => this.receive(text),
      onclose: () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.online = false;
        if (!this.active || this.denied) return;
        this.armOffline();
        const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.attempt++);
        this.retryTimer = setTimeout(() => this.connect(), delay);
      }
    });
    this.socket = socket;
  }

  /** « Hors ligne » seulement si la coupure dure : pas d'indicateur pendant une (re)connexion rapide. */
  private armOffline() {
    if (this.offline || this.offlineTimer) return;
    this.offlineTimer = setTimeout(() => {
      this.offlineTimer = undefined;
      if (this.active && !this.online) this.offline = true;
    }, OFFLINE_AFTER_MS);
  }

  private receive(text: string) {
    let msg: WsServerMessage;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'subscribed':
        // Premier abonnement ou reconnexion : ce qui a changé entre-temps n'est pas rejoué.
        if (sameScope(msg.scope, board.ref)) board.sync();
        break;
      case 'changed':
        if (msg.kind === 'comments' && msg.card_id != null) {
          this.commentTicks.set(msg.card_id, this.commentChanges(msg.card_id) + 1);
        }
        // Commentaires compris : le tableau rechargé porte le nombre de commentaires de chaque carte.
        board.sync();
        break;
      case 'revoked':
        this.scope = null;
        toast.info('Vous n’avez plus accès à ce tableau');
        void goto('/pools');
        break;
      case 'error':
        if (msg.status === 401) {
          // Session expirée : une requête REST la fermera (retour à la connexion) ; on ne se reconnecte pas.
          this.denied = true;
          void api.me().catch(() => {});
        } else if (msg.status === 403 || msg.status === 404) {
          // Abonnement refusé : le tableau a disparu ou n'est plus accessible ; le rechargement l'affichera.
          board.sync();
        }
        break;
    }
  }

  /** Retour au premier plan : rechargement (événements possiblement manqués), reconnexion immédiate si coupé. */
  private onvisible = () => {
    if (document.visibilityState !== 'visible' || !this.active) return;
    board.sync();
    if (!this.socket && !this.denied) {
      this.attempt = 0;
      this.connect();
    }
  };
}

export const realtime = new Realtime();
