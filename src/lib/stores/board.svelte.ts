// État du tableau ouvert. Les mutations sont optimistes : l'UI bouge tout de suite,
// puis la réponse serveur fait foi ; en cas d'erreur on revient en arrière avec un toast.
//
// Modifications d'une même carte : envoyées l'une après l'autre (le serveur les applique dans l'ordre où
// l'utilisateur les a faites) et seule la réponse de la plus récente est appliquée. Une réponse en retard
// ne ramène donc jamais la carte à un état intermédiaire (←/→ répétés sur la chronologie, glissers rapides),
// et une carte supprimée n'est jamais réinsérée par une réponse tardive.

import { untrack } from 'svelte';
import { api, ApiError } from '$lib/api';
import { computeSchedule } from '$lib/dates';
import type { Assignee } from '$lib/types/Assignee';
import type { BoardDetail } from '$lib/types/BoardDetail';
import type { Card } from '$lib/types/Card';
import type { CreateCard } from '$lib/types/CreateCard';
import type { Member } from '$lib/types/Member';
import type { State } from '$lib/types/State';
import type { UpdateCard } from '$lib/types/UpdateCard';
import type { UpdateState } from '$lib/types/UpdateState';
import { boardsCache } from './boards-cache';
import { toast } from './toast.svelte';

const byPosition = <T extends { position: number; id: number }>(a: T, b: T) => a.position - b.position || a.id - b.id;

/** Position flottante entre deux voisins (insertion sans renuméroter). */
export function positionBetween(prev?: number, next?: number): number {
  if (prev != null && next != null) return (prev + next) / 2;
  if (prev != null) return prev + 1;
  if (next != null) return next - 1;
  return 0;
}

/**
 * Miroir de `renormalize` (crates/server/src/routes/members.rs) : parts restantes ramenées à 100 %
 * après le retrait d'un assigné, par la méthode du plus fort reste (à égalité : plus grosse part, puis plus
 * petit id). Liste vide ou totalisant déjà 100 : inchangée. Ordre du serveur : part décroissante, puis id.
 */
function renormalize(rest: Assignee[]): Assignee[] {
  const total = rest.reduce((sum, a) => sum + a.pct, 0);
  if (total < 1 || total >= 100) return rest;
  const shares = rest.map((a) => ({
    user_id: a.user_id,
    pct: Math.floor((a.pct * 100) / total),
    rem: (a.pct * 100) % total,
    orig: a.pct
  }));
  const missing = 100 - shares.reduce((sum, s) => sum + s.pct, 0);
  [...shares]
    .sort((a, b) => b.rem - a.rem || b.orig - a.orig || a.user_id - b.user_id)
    .slice(0, missing)
    .forEach((s) => s.pct++);
  return shares.map(({ user_id, pct }) => ({ user_id, pct })).sort((a, b) => b.pct - a.pct || a.user_id - b.user_id);
}

class BoardStore {
  detail = $state<BoardDetail | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  /** Statut HTTP de l'échec de chargement (403 : pas membre, 404 : introuvable ; 0 : serveur injoignable). */
  errorStatus = $state<number | null>(null);

  states: State[] = $derived(this.detail ? [...this.detail.states].sort(byPosition) : []);
  members: Member[] = $derived(this.detail?.members ?? []);
  cards: Card[] = $derived(this.detail?.cards ?? []);
  isOwner: boolean = $derived(this.detail?.board.role === 'owner');

  /** Incrémenté à chaque chargement (et à `reset`) : la réponse d'un chargement dépassé est ignorée. */
  private loadToken = 0;

  cardsInState(stateId: number): Card[] {
    return this.cards.filter((c) => c.state_id === stateId).sort(byPosition);
  }

  card(id: number): Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  member(userId: number): Member | undefined {
    return this.members.find((m) => m.user_id === userId);
  }

  /** Charge un tableau. Appelable depuis un `$effect` : l'état courant y est lu sans être suivi. */
  async load(id: number) {
    const token = ++this.loadToken;
    if (untrack(() => this.detail?.board.id) !== id) this.detail = null;
    this.loading = true;
    this.error = null;
    this.errorStatus = null;
    try {
      const detail = await api.getBoard(id);
      if (token === this.loadToken) this.detail = detail;
    } catch (e) {
      if (token === this.loadToken) {
        this.error = e instanceof Error ? e.message : String(e);
        this.errorStatus = e instanceof ApiError ? e.status : null;
      }
    } finally {
      if (token === this.loadToken) this.loading = false;
    }
  }

  /** Recharge le tableau ouvert (lève l'erreur réseau éventuelle). Ignoré si un autre tableau a été ouvert entre-temps. */
  async refresh() {
    const id = this.detail?.board.id;
    if (id == null) return;
    const token = this.loadToken;
    const detail = await api.getBoard(id);
    if (token === this.loadToken && this.detail?.board.id === id) this.detail = detail;
  }

  /** Oublie le tableau ouvert (déconnexion, changement de serveur) ; les chargements en vol sont ignorés. */
  reset() {
    this.loadToken++;
    this.detail = null;
    this.loading = false;
    this.error = null;
    this.errorStatus = null;
  }

  // ---------- Cartes : file de requêtes par carte ----------

  /** Numéro de la dernière requête de modification de chaque carte : seule sa réponse est appliquée. */
  private cardSeq = new Map<number, number>();
  /** Fin de la dernière requête en file pour chaque carte : la suivante part après elle. */
  private cardQueue = new Map<number, Promise<unknown>>();
  /** Cartes dont une modification intermédiaire a échoué : relues au serveur si la dernière échoue aussi. */
  private cardStale = new Set<number>();

  private enqueue<T>(id: number, send: () => Promise<T>): { seq: number; done: Promise<T> } {
    const seq = (this.cardSeq.get(id) ?? 0) + 1;
    this.cardSeq.set(id, seq);
    const done = (this.cardQueue.get(id) ?? Promise.resolve()).then(send);
    const tail = done.catch(() => {});
    this.cardQueue.set(id, tail);
    void tail.then(() => {
      if (this.cardQueue.get(id) === tail) this.cardQueue.delete(id);
    });
    return { seq, done };
  }

  private isLatest(id: number, seq: number): boolean {
    return this.cardSeq.get(id) === seq;
  }

  /** Relit une carte au serveur (après des échecs en cascade), sauf si une nouvelle modification est partie entre-temps. */
  private async resync(id: number) {
    const seq = this.cardSeq.get(id);
    try {
      const fresh = await api.getCard(id);
      if (this.cardSeq.get(id) === seq) this.replaceCard(fresh);
    } catch {
      /* la prochaine modification ou un rechargement remettra la carte d'accord */
    }
  }

  /** Remplace une carte connue ; ne réinsère jamais une carte absente (supprimée entre-temps). */
  private replaceCard(card: Card) {
    if (!this.detail) return;
    const i = this.detail.cards.findIndex((c) => c.id === card.id);
    if (i >= 0) this.detail.cards[i] = card;
  }

  async createCard(input: CreateCard): Promise<Card | null> {
    if (!this.detail) return null;
    const boardId = this.detail.board.id;
    try {
      const card = await api.createCard(boardId, input);
      if (this.detail?.board.id === boardId && !this.card(card.id)) this.detail.cards.push(card);
      return card;
    } catch (e) {
      toast.error(e);
      return null;
    }
  }

  async updateCard(id: number, patch: UpdateCard): Promise<boolean> {
    const before = this.card(id);
    if (!before) return false;
    const snapshot = $state.snapshot(before) as Card;
    const optimistic: Card = { ...snapshot };
    if (patch.state_id !== undefined) optimistic.state_id = patch.state_id;
    if (patch.position !== undefined) optimistic.position = patch.position;
    if (patch.title !== undefined) optimistic.title = patch.title;
    if (patch.description !== undefined) optimistic.description = patch.description;
    if (patch.priority !== undefined) optimistic.priority = patch.priority;
    if (patch.estimate_days !== undefined) optimistic.estimate_days = patch.estimate_days;
    if (patch.start_date !== undefined) optimistic.start_date = patch.start_date;
    optimistic.schedule = computeSchedule(optimistic.start_date, optimistic.estimate_days, optimistic.assignees.map((a) => a.pct));
    this.replaceCard(optimistic);
    const { seq, done } = this.enqueue(id, () => api.updateCard(id, patch));
    try {
      const saved = await done;
      if (this.isLatest(id, seq)) {
        this.cardStale.delete(id);
        this.replaceCard(saved);
      }
      return true;
    } catch (e) {
      if (this.isLatest(id, seq)) {
        // État d'avant cette modification ; si une modification antérieure a aussi échoué, il la contient : on relit.
        this.replaceCard(snapshot);
        if (this.cardStale.delete(id)) void this.resync(id);
      } else {
        // Une modification plus récente (construite sur celle-ci) est en file : sa réponse fera foi.
        this.cardStale.add(id);
      }
      toast.error(e);
      return false;
    }
  }

  async setAssignees(id: number, assignees: Assignee[]): Promise<boolean> {
    const { seq, done } = this.enqueue(id, () => api.setAssignees(id, assignees));
    try {
      const saved = await done;
      if (this.isLatest(id, seq)) {
        this.cardStale.delete(id);
        this.replaceCard(saved);
      } else {
        // Une modification plus récente est en file (sa réponse fera foi) : on reflète déjà la répartition.
        const current = this.card(id);
        if (current) {
          const pcts = saved.assignees.map((a) => a.pct);
          this.replaceCard({
            ...($state.snapshot(current) as Card),
            assignees: saved.assignees,
            schedule: computeSchedule(current.start_date, current.estimate_days, pcts)
          });
        }
      }
      return true;
    } catch (e) {
      if (this.isLatest(id, seq) && this.cardStale.delete(id)) void this.resync(id);
      toast.error(e);
      return false;
    }
  }

  async deleteCard(id: number): Promise<boolean> {
    if (!this.detail) return false;
    const boardId = this.detail.board.id;
    const target = this.card(id);
    if (!target) return false;
    const removed = $state.snapshot(target) as Card;
    this.detail.cards = this.detail.cards.filter((c) => c.id !== id);
    // En file derrière les modifications en cours ; leurs réponses (devenues anciennes) sont ignorées.
    const { done } = this.enqueue(id, () => api.deleteCard(id));
    try {
      await done;
      this.cardStale.delete(id);
      return true;
    } catch (e) {
      // On ne remet que cette carte : les autres ont pu changer pendant la requête.
      if (this.detail?.board.id === boardId && !this.card(id)) this.detail.cards.push(removed);
      if (this.cardStale.delete(id)) void this.resync(id);
      toast.error(e);
      return false;
    }
  }

  // ---------- États (colonnes) ----------

  async createState(name: string, color?: string): Promise<State | null> {
    if (!this.detail) return null;
    const boardId = this.detail.board.id;
    try {
      const state = await api.createState(boardId, { name, color });
      if (this.detail?.board.id === boardId) this.detail.states.push(state);
      return state;
    } catch (e) {
      toast.error(e);
      return null;
    }
  }

  async updateState(id: number, patch: UpdateState): Promise<boolean> {
    if (!this.detail) return false;
    const i = this.detail.states.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const snapshot = $state.snapshot(this.detail.states[i]) as State;
    this.detail.states[i] = { ...snapshot, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    try {
      const updated = await api.updateState(id, patch);
      const j = this.detail?.states.findIndex((s) => s.id === id) ?? -1;
      if (this.detail && j >= 0) this.detail.states[j] = updated;
      return true;
    } catch (e) {
      const j = this.detail?.states.findIndex((s) => s.id === id) ?? -1;
      if (this.detail && j >= 0) this.detail.states[j] = snapshot;
      toast.error(e);
      return false;
    }
  }

  async deleteState(id: number): Promise<boolean> {
    if (!this.detail) return false;
    try {
      await api.deleteState(id);
      if (this.detail) this.detail.states = this.detail.states.filter((s) => s.id !== id);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  // ---------- Tableau & membres ----------

  async rename(name: string): Promise<boolean> {
    if (!this.detail) return false;
    const boardId = this.detail.board.id;
    try {
      const updated = await api.renameBoard(boardId, name);
      if (this.detail?.board.id === boardId) this.detail.board = updated;
      boardsCache.update((list) => list.map((b) => (b.id === boardId ? { ...b, name: updated.name } : b)));
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  async addMember(email: string): Promise<boolean> {
    if (!this.detail) return false;
    const boardId = this.detail.board.id;
    try {
      const member = await api.addMember(boardId, email);
      if (this.detail?.board.id === boardId) this.detail.members.push(member);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  /**
   * Retire un membre (ou soi-même : quitter le tableau). Comme le serveur, ses assignations disparaissent
   * et les parts restantes de chaque carte concernée sont ramenées à 100 %.
   */
  async removeMember(userId: number): Promise<boolean> {
    if (!this.detail) return false;
    const boardId = this.detail.board.id;
    try {
      await api.removeMember(boardId, userId);
      // Miroir local de ce que fait le serveur (évite un rechargement, et un 403 si on vient de quitter).
      if (this.detail?.board.id !== boardId) return true;
      this.detail.members = this.detail.members.filter((m) => m.user_id !== userId);
      for (const c of this.detail.cards) {
        if (c.assignees.some((a) => a.user_id === userId)) {
          c.assignees = renormalize(c.assignees.filter((a) => a.user_id !== userId));
          c.schedule = computeSchedule(c.start_date, c.estimate_days, c.assignees.map((a) => a.pct));
        }
      }
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }
}

export const board = new BoardStore();
