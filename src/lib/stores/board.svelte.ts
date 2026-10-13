// État du tableau ouvert : un pool (cartes de tous ses projets) ou un projet (ses seules cartes). Les mutations sont optimistes : l'UI bouge tout de suite,
// puis la réponse serveur fait foi ; en cas d'erreur on revient en arrière avec un toast.
//
// Modifications d'une même carte : envoyées l'une après l'autre (le serveur les applique dans l'ordre où
// l'utilisateur les a faites) et seule la réponse de la plus récente est appliquée. Une réponse en retard
// ne ramène donc jamais la carte à un état intermédiaire (←/→ répétés sur la chronologie, glissers rapides),
// et une carte supprimée n'est jamais réinsérée par une réponse tardive.

import { untrack } from 'svelte';
import { api, ApiError } from '$lib/api';
import { NO_TYPE } from '$lib/cardTypes';
import { byShare, DEFAULT_OCCUPANCY, withSchedules } from '$lib/dates';
import type { Assignee } from '$lib/types/Assignee';
import type { AssigneeInput } from '$lib/types/AssigneeInput';
import type { Card } from '$lib/types/Card';
import type { CardType } from '$lib/types/CardType';
import type { CreateCard } from '$lib/types/CreateCard';
import type { CreateProject } from '$lib/types/CreateProject';
import type { Member } from '$lib/types/Member';
import type { Pool } from '$lib/types/Pool';
import type { Project } from '$lib/types/Project';
import type { ScopeDetail } from '$lib/types/ScopeDetail';
import type { ScopeKind } from '$lib/types/ScopeKind';
import type { State } from '$lib/types/State';
import type { UpdateCard } from '$lib/types/UpdateCard';
import type { UpdateCardType } from '$lib/types/UpdateCardType';
import type { UpdatePause } from '$lib/types/UpdatePause';
import type { UpdateProject } from '$lib/types/UpdateProject';
import type { UpdateState } from '$lib/types/UpdateState';
import { poolsCache } from './pools-cache';
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
 * Miroir de `renormalize` (server/crates/server/src/scope.rs) : parts restantes ramenées à 100 % après le retrait
 * d'un assigné, par mise à l'échelle proportionnelle (la dernière, dans l'ordre du serveur, absorbe l'arrondi).
 * Occupation et date de début conservées. Liste vide ou totalisant déjà 100 : inchangée. Planifications à recalculer.
 */
function renormalize(rest: Assignee[]): Assignee[] {
  const sorted = [...rest].sort(byShare);
  const total = sorted.reduce((sum, a) => sum + a.pct, 0);
  if (!sorted.length || !(Number.isFinite(total) && total > 0) || Math.abs(total - 100) < 1e-9) return sorted;
  const shares = sorted.map((a) => ({ ...a, pct: (a.pct * 100) / total }));
  const others = shares.slice(0, -1).reduce((sum, a) => sum + a.pct, 0);
  shares[shares.length - 1].pct = Math.min(100, Math.max(Number.MIN_VALUE, 100 - others));
  return shares.sort(byShare);
}

/**
 * Assignés tels que le serveur les enregistre (sans date propre vide, occupation par défaut), planifications à recalculer.
 * Comme le serveur, les personnes gardées conservent leurs pauses (`before` : assignés actuels de la carte).
 */
function fromInput(list: AssigneeInput[], before: Assignee[] = []): Assignee[] {
  const pauses = new Map(before.map((a) => [a.user_id, a.pauses]));
  return list
    .map((a) => ({
      user_id: a.user_id,
      pct: a.pct,
      occupancy: a.occupancy ?? DEFAULT_OCCUPANCY,
      start_date: a.start_date?.trim() || null,
      pauses: pauses.get(a.user_id) ?? [],
      schedule: null
    }))
    .sort(byShare);
}

export interface ScopeRef {
  kind: ScopeKind;
  id: number;
}

const FILTER_KEY = (poolId: number) => `pm.filter.pool.${poolId}`;
/** Filtre par type : mémorisé par pool (ou par projet sans pool, qui a ses propres types). */
const TYPE_FILTER_KEY = (ref: ScopeRef) => `pm.typefilter.${ref.kind}.${ref.id}`;

/** Portée des types d'un tableau : le pool (vue pool ou projet rattaché), sinon le projet autonome. */
function typeScope(d: ScopeDetail): ScopeRef | null {
  if (d.pool) return { kind: 'pool', id: d.pool.id };
  if (d.project) return { kind: 'project', id: d.project.id };
  return null;
}

function scopeId(d: ScopeDetail | null): ScopeRef | null {
  if (!d) return null;
  const id = d.kind === 'pool' ? d.pool?.id : d.project?.id;
  return id == null ? null : { kind: d.kind, id };
}

function sameScope(a: ScopeRef | null, b: ScopeRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

class BoardStore {
  detail = $state<ScopeDetail | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  /** Statut HTTP de l'échec de chargement (403 : pas d'accès, 404 : introuvable ; 0 : serveur injoignable). */
  errorStatus = $state<number | null>(null);
  /** Projets affichés dans un pool (vide = tous) ; mémorisé par pool. */
  projectFilter = $state<number[]>([]);
  /** Types affichés (vide = tous ; `NO_TYPE` = cartes sans type) ; mémorisé par pool (ou projet autonome). */
  typeFilter = $state<number[]>([]);

  kind: ScopeKind | null = $derived(this.detail?.kind ?? null);
  pool: Pool | null = $derived(this.detail?.pool ?? null);
  /** Projet ouvert (vue projet uniquement). */
  project: Project | null = $derived(this.detail?.kind === 'project' ? (this.detail.project ?? null) : null);
  /** Projets du pool (archivés compris) ou le projet ouvert. */
  projects: Project[] = $derived(this.detail?.projects ?? []);
  /** Projets dans lesquels on peut créer des cartes. */
  activeProjects: Project[] = $derived(this.projects.filter((p) => !p.archived));
  states: State[] = $derived(this.detail ? [...this.detail.states].sort(byPosition) : []);
  members: Member[] = $derived(this.detail?.members ?? []);
  cards: Card[] = $derived(this.detail?.cards ?? []);
  /** Types de cartes applicables, dans l'ordre choisi. */
  types: CardType[] = $derived(this.detail ? [...this.detail.types].sort(byPosition) : []);
  /** Cartes après filtres par projet (pool) et par type : ce que montrent le Kanban et la chronologie. */
  visibleCards: Card[] = $derived.by(() => {
    let list = this.cards;
    if (this.kind === 'pool' && this.projectFilter.length) list = list.filter((c) => this.projectFilter.includes(c.project_id));
    const types = this.typeFilter;
    if (types.length) list = list.filter((c) => types.includes(c.type_id ?? NO_TYPE));
    return list;
  });
  /** Gestion du pool (renommer, membres) : propriétaire du pool. Projet sans pool : on en est forcément le propriétaire. */
  isOwner: boolean = $derived(this.pool ? this.pool.role === 'owner' : this.kind === 'project');
  /** Titre du tableau ouvert. */
  title: string = $derived(this.kind === 'pool' ? (this.pool?.name ?? '') : (this.project?.name ?? ''));

  /** Incrémenté à chaque chargement (et à `reset`) : la réponse d'un chargement dépassé est ignorée. */
  private loadToken = 0;

  get ref(): ScopeRef | null {
    return scopeId(this.detail);
  }

  cardsInState(stateId: number): Card[] {
    return this.visibleCards.filter((c) => c.state_id === stateId).sort(byPosition);
  }

  card(id: number): Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  member(userId: number): Member | undefined {
    return this.members.find((m) => m.user_id === userId);
  }

  /** Type d'une carte (`null`/inconnu : aucun). */
  type(id: number | null | undefined): CardType | undefined {
    return id == null ? undefined : this.types.find((t) => t.id === id);
  }

  projectOf(id: number): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  /** Référence lisible d'une carte : `SITE-12`. */
  cardKey(card: Card): string {
    const code = this.projectOf(card.project_id)?.code ?? '?';
    return `${code}-${card.number}`;
  }

  setProjectFilter(ids: number[]) {
    this.projectFilter = ids;
    const pool = this.pool;
    if (this.kind === 'pool' && pool) {
      if (ids.length) localStorage.setItem(FILTER_KEY(pool.id), JSON.stringify(ids));
      else localStorage.removeItem(FILTER_KEY(pool.id));
    }
  }

  setTypeFilter(ids: number[]) {
    this.typeFilter = ids;
    const scope = this.detail ? typeScope(this.detail) : null;
    if (!scope) return;
    if (ids.length) localStorage.setItem(TYPE_FILTER_KEY(scope), JSON.stringify(ids));
    else localStorage.removeItem(TYPE_FILTER_KEY(scope));
  }

  private restoreTypeFilter(d: ScopeDetail) {
    const scope = typeScope(d);
    try {
      const saved = scope ? JSON.parse(localStorage.getItem(TYPE_FILTER_KEY(scope)) ?? '[]') : [];
      const known = new Set([NO_TYPE, ...d.types.map((t) => t.id)]);
      this.typeFilter = Array.isArray(saved) ? saved.filter((id): id is number => typeof id === 'number' && known.has(id)) : [];
    } catch {
      this.typeFilter = [];
    }
  }

  private restoreFilter(d: ScopeDetail) {
    this.restoreTypeFilter(d);
    if (d.kind !== 'pool' || !d.pool) {
      this.projectFilter = [];
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY(d.pool.id)) ?? '[]');
      const known = new Set(d.projects.filter((p) => !p.archived).map((p) => p.id));
      this.projectFilter = Array.isArray(saved) ? saved.filter((id): id is number => typeof id === 'number' && known.has(id)) : [];
    } catch {
      this.projectFilter = [];
    }
  }

  private fetch(ref: ScopeRef): Promise<ScopeDetail> {
    return ref.kind === 'pool' ? api.getPool(ref.id) : api.getProject(ref.id);
  }

  /** Charge un pool ou un projet. Appelable depuis un `$effect` : l'état courant y est lu sans être suivi. */
  async load(ref: ScopeRef) {
    const token = ++this.loadToken;
    if (!sameScope(untrack(() => this.ref), ref)) this.detail = null;
    this.loading = true;
    this.error = null;
    this.errorStatus = null;
    try {
      const detail = await this.fetch(ref);
      if (token === this.loadToken) {
        this.restoreFilter(detail);
        this.detail = detail;
      }
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
    const ref = this.ref;
    if (!ref) return;
    const token = this.loadToken;
    const detail = await this.fetch(ref);
    if (token === this.loadToken && sameScope(this.ref, ref)) {
      this.restoreFilter(detail);
      this.detail = detail;
    }
  }

  /** Oublie le tableau ouvert (déconnexion, changement de serveur) ; les chargements en vol sont ignorés. */
  reset() {
    this.loadToken++;
    this.detail = null;
    this.loading = false;
    this.error = null;
    this.errorStatus = null;
    this.projectFilter = [];
    this.typeFilter = [];
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

  async createCard(projectId: number, input: CreateCard): Promise<Card | null> {
    if (!this.detail) return null;
    const ref = this.ref;
    try {
      const card = await api.createCard(projectId, input);
      if (sameScope(this.ref, ref) && this.detail && !this.card(card.id)) this.detail.cards.push(card);
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
    if (patch.type_id !== undefined) optimistic.type_id = patch.type_id;
    if (patch.project_id !== undefined) optimistic.project_id = patch.project_id;
    if (patch.position !== undefined) optimistic.position = patch.position;
    if (patch.title !== undefined) optimistic.title = patch.title;
    if (patch.description !== undefined) optimistic.description = patch.description;
    if (patch.priority !== undefined) optimistic.priority = patch.priority;
    if (patch.estimate_days !== undefined) optimistic.estimate_days = patch.estimate_days;
    if (patch.start_date !== undefined) optimistic.start_date = patch.start_date;
    this.replaceCard(withSchedules(optimistic));
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

  /**
   * Remplace les assignés d'une carte (parts en pleine précision, total 100). Optimiste : les planifications
   * de chacun et celle de la carte sont recalculées tout de suite ; en cas d'échec, la carte revient en arrière.
   */
  async setAssignees(id: number, list: AssigneeInput[]): Promise<boolean> {
    const before = this.card(id);
    if (!before) return false;
    const snapshot = $state.snapshot(before) as Card;
    this.replaceCard(withSchedules({ ...snapshot, assignees: fromInput(list, snapshot.assignees) }));
    const { seq, done } = this.enqueue(id, () => api.setAssignees(id, list));
    try {
      const saved = await done;
      if (this.isLatest(id, seq)) {
        this.cardStale.delete(id);
        this.replaceCard(saved);
      }
      return true;
    } catch (e) {
      if (this.isLatest(id, seq)) {
        this.replaceCard(snapshot);
        if (this.cardStale.delete(id)) void this.resync(id);
      } else {
        this.cardStale.add(id);
      }
      toast.error(e);
      return false;
    }
  }

  /**
   * Action sur les pauses d'un assigné (pause, reprise, correction, suppression) : pas d'optimisme, la carte
   * renvoyée par le serveur (planifications recalculées) remplace celle du store. En file avec les autres
   * modifications de la carte ; si une plus récente est partie entre-temps, c'est sa réponse qui fera foi.
   */
  private async pauseAction(id: number, send: () => Promise<Card>): Promise<boolean> {
    if (!this.card(id)) return false;
    const { seq, done } = this.enqueue(id, send);
    try {
      const saved = await done;
      if (this.isLatest(id, seq)) {
        this.cardStale.delete(id);
        this.replaceCard(saved);
      }
      return true;
    } catch (e) {
      if (this.isLatest(id, seq) && this.cardStale.delete(id)) void this.resync(id);
      toast.error(e);
      return false;
    }
  }

  /** Met la part d'un assigné en pause (à partir d'aujourd'hui par défaut). */
  pauseAssignee(cardId: number, userId: number, date?: string): Promise<boolean> {
    return this.pauseAction(cardId, () => api.pauseAssignee(cardId, userId, date));
  }

  /** Reprend la part d'un assigné en pause (`date` : jour de reprise, aujourd'hui par défaut). */
  resumeAssignee(cardId: number, userId: number, date?: string): Promise<boolean> {
    return this.pauseAction(cardId, () => api.resumeAssignee(cardId, userId, date));
  }

  /** Corrige une pause (`end_date: null` la rouvre). */
  updatePause(cardId: number, pauseId: number, patch: UpdatePause): Promise<boolean> {
    return this.pauseAction(cardId, () => api.updatePause(pauseId, patch));
  }

  deletePause(cardId: number, pauseId: number): Promise<boolean> {
    return this.pauseAction(cardId, () => api.deletePause(pauseId));
  }

  /** Nombre de commentaires d'une carte, tenu à jour par la fiche (ajout, suppression, liste rechargée). */
  setCommentCount(id: number, count: number) {
    const c = this.detail?.cards.find((x) => x.id === id);
    if (c && c.comment_count !== count) c.comment_count = count;
  }

  async deleteCard(id: number): Promise<boolean> {
    if (!this.detail) return false;
    const ref = this.ref;
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
      if (sameScope(this.ref, ref) && this.detail && !this.card(id)) this.detail.cards.push(removed);
      if (this.cardStale.delete(id)) void this.resync(id);
      toast.error(e);
      return false;
    }
  }

  // ---------- États (colonnes) ----------

  async createState(name: string, color?: string): Promise<State | null> {
    if (!this.detail) return null;
    const ref = this.ref;
    // Colonnes du pool (vue pool, ou projet rattaché), sinon colonnes propres du projet autonome.
    const poolId = this.pool?.id;
    const projectId = this.project?.id;
    try {
      const state =
        poolId != null
          ? await api.createPoolState(poolId, { name, color })
          : await api.createProjectState(projectId!, { name, color });
      if (sameScope(this.ref, ref) && this.detail) this.detail.states.push(state);
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

  // ---------- Types de cartes ----------

  async createType(name: string, icon: string): Promise<CardType | null> {
    if (!this.detail) return null;
    const ref = this.ref;
    // Types du pool (vue pool, ou projet rattaché), sinon types propres du projet autonome.
    const poolId = this.pool?.id;
    const projectId = this.project?.id;
    try {
      const type =
        poolId != null ? await api.createPoolType(poolId, { name, icon }) : await api.createProjectType(projectId!, { name, icon });
      if (sameScope(this.ref, ref) && this.detail && !this.detail.types.some((t) => t.id === type.id)) this.detail.types.push(type);
      return type;
    } catch (e) {
      toast.error(e);
      return null;
    }
  }

  async updateType(id: number, patch: UpdateCardType): Promise<boolean> {
    if (!this.detail) return false;
    const i = this.detail.types.findIndex((t) => t.id === id);
    if (i < 0) return false;
    const snapshot = $state.snapshot(this.detail.types[i]) as CardType;
    this.detail.types[i] = { ...snapshot, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    try {
      const updated = await api.updateType(id, patch);
      const j = this.detail?.types.findIndex((t) => t.id === id) ?? -1;
      if (this.detail && j >= 0) this.detail.types[j] = updated;
      return true;
    } catch (e) {
      const j = this.detail?.types.findIndex((t) => t.id === id) ?? -1;
      if (this.detail && j >= 0) this.detail.types[j] = snapshot;
      toast.error(e);
      return false;
    }
  }

  /** Supprime un type ; comme le serveur, ses cartes repassent sans type. */
  async deleteType(id: number): Promise<boolean> {
    if (!this.detail) return false;
    try {
      await api.deleteType(id);
      if (!this.detail) return true;
      this.detail.types = this.detail.types.filter((t) => t.id !== id);
      for (const c of this.detail.cards) if (c.type_id === id) c.type_id = null;
      if (this.typeFilter.includes(id)) this.setTypeFilter(this.typeFilter.filter((t) => t !== id));
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  // ---------- Pool, projets & membres ----------

  /** Renomme le tableau ouvert : le pool, ou le projet. */
  async rename(name: string): Promise<boolean> {
    if (this.kind === 'project' && this.project) return this.updateProject(this.project.id, { name });
    const pool = this.pool;
    if (!this.detail || !pool) return false;
    try {
      const updated = await api.renamePool(pool.id, name);
      if (this.detail?.pool?.id === pool.id) this.detail.pool = updated;
      poolsCache.update((list) => list.map((p) => (p.id === pool.id ? { ...p, name: updated.name } : p)));
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  async createProject(input: CreateProject): Promise<Project | null> {
    try {
      const project = await api.createProject(input);
      if (this.detail && this.kind === 'pool' && project.pool_id === this.pool?.id) this.detail.projects.push(project);
      return project;
    } catch (e) {
      toast.error(e);
      return null;
    }
  }

  /**
   * Modifie un projet. Un changement de pool ou d'archivage change les cartes et colonnes visibles :
   * le tableau est alors rechargé (et quitté s'il n'est plus accessible, à la charge de l'appelant).
   */
  async updateProject(id: number, patch: UpdateProject): Promise<boolean> {
    try {
      const updated = await api.updateProject(id, patch);
      if (!this.detail) return true;
      if (patch.pool_id !== undefined || patch.archived !== undefined) {
        await this.refresh().catch(() => {});
        return true;
      }
      const i = this.detail.projects.findIndex((p) => p.id === id);
      if (i >= 0) this.detail.projects[i] = updated;
      if (this.detail.project?.id === id) this.detail.project = updated;
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  async deleteProject(id: number): Promise<boolean> {
    try {
      await api.deleteProject(id);
      if (this.detail && this.kind === 'pool') {
        this.detail.projects = this.detail.projects.filter((p) => p.id !== id);
        this.detail.cards = this.detail.cards.filter((c) => c.project_id !== id);
        if (this.projectFilter.includes(id)) this.setProjectFilter(this.projectFilter.filter((p) => p !== id));
      }
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  async addMember(email: string): Promise<boolean> {
    const pool = this.pool;
    if (!this.detail || !pool) return false;
    try {
      const member = await api.addMember(pool.id, email);
      if (this.detail?.pool?.id === pool.id) this.detail.members.push(member);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  /**
   * Retire un membre du pool (ou soi-même : quitter le pool). Comme le serveur, ses assignations disparaissent
   * et les parts restantes de chaque carte concernée sont ramenées à 100 %.
   */
  async removeMember(userId: number): Promise<boolean> {
    const pool = this.pool;
    if (!this.detail || !pool) return false;
    try {
      await api.removeMember(pool.id, userId);
      // Miroir local de ce que fait le serveur (évite un rechargement, et un 403 si on vient de quitter).
      if (this.detail?.pool?.id !== pool.id) return true;
      this.detail.members = this.detail.members.filter((m) => m.user_id !== userId);
      for (const c of this.detail.cards) {
        if (c.assignees.some((a) => a.user_id === userId)) {
          const next = withSchedules({ ...($state.snapshot(c) as Card), assignees: renormalize(c.assignees.filter((a) => a.user_id !== userId)) });
          c.assignees = next.assignees;
          c.schedule = next.schedule;
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
