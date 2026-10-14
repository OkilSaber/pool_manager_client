// Client HTTP typé vers le serveur Pool Manager.
// Dans Tauri, les requêtes passent par le plugin http (Rust) : pas de CORS ni de blocage
// « mixed content » vers un serveur http du LAN. Dans un navigateur (dev), fetch natif.

import type { AssigneeInput } from './types/AssigneeInput';
import type { AuthResponse } from './types/AuthResponse';
import type { Card } from './types/Card';
import type { CardType } from './types/CardType';
import type { Comment } from './types/Comment';
import type { CreateCard } from './types/CreateCard';
import type { CreateCardType } from './types/CreateCardType';
import type { CreateProject } from './types/CreateProject';
import type { CreateState } from './types/CreateState';
import type { Member } from './types/Member';
import type { PauseDate } from './types/PauseDate';
import type { Pool } from './types/Pool';
import type { Project } from './types/Project';
import type { ScopeDetail } from './types/ScopeDetail';
import type { State } from './types/State';
import type { UpdateCard } from './types/UpdateCard';
import type { UpdateCardType } from './types/UpdateCardType';
import type { UpdatePause } from './types/UpdatePause';
import type { UpdateProject } from './types/UpdateProject';
import type { UpdateState } from './types/UpdateState';
import type { User } from './types/User';

const SERVER_KEY = 'pm.server';
const TOKEN_KEY = 'pm.token';
export const DEFAULT_SERVER = 'http://localhost:8080';

export function getServerUrl(): string {
  return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER;
}

export function setServerUrl(url: string) {
  localStorage.setItem(SERVER_KEY, url.trim().replace(/\/+$/, '') || DEFAULT_SERVER);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Appelé quand le serveur répond 401 (session expirée) ; branché par le store de session.
 * Reçoit le jeton envoyé : une réponse tardive à une requête de l'ancienne session ne doit pas fermer la nouvelle.
 */
let onUnauthorized: (token: string) => void = () => {};
export function setUnauthorizedHandler(fn: (token: string) => void) {
  onUnauthorized = fn;
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Identifiant aléatoire de cette instance de l'app (gardé jusqu'au prochain lancement). */
function randomId(): string {
  // `randomUUID` n'existe qu'en contexte sécurisé : pas dans un navigateur sur `http://192.168.…`.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Origine de nos écritures : envoyée en `X-Client-Id` sur chaque requête et à l'authentification de la
 * WebSocket temps réel, pour que le serveur ne nous renvoie pas l'écho de nos propres modifications.
 */
export const CLIENT_ID = randomId();

/**
 * Délai maximal d'une requête. Sans lui, une IP absente du réseau local fait attendre jusqu'au délai
 * système (souvent plus d'une minute) : écran vide au lancement (`me()`), actions figées.
 */
const REQUEST_TIMEOUT_MS = 15_000;
/** Vérifications rapides (test du serveur, session au lancement : l'écran attend leur réponse). */
const QUICK_TIMEOUT_MS = 6_000;

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export async function doFetch(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const withTimeout: RequestInit = { ...init, signal: timeoutSignal(timeoutMs) };
  if (isTauri) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url, withTimeout);
  }
  return window.fetch(url, withTimeout);
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Client-Id': CLIENT_ID };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await doFetch(
      `${getServerUrl()}/api${path}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      timeoutMs
    );
  } catch {
    throw new ApiError(0, `Serveur injoignable (${getServerUrl()})`);
  }

  if (res.status === 401 && token) onUnauthorized(token);
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* corps vide */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    // Corps interrompu (délai dépassé en cours de lecture, connexion coupée) ou invalide.
    throw new ApiError(0, `Réponse incomplète du serveur (${getServerUrl()})`);
  }
}

export const api = {
  /** Vérifie qu'un serveur répond (URL courante par défaut). */
  health: async (serverUrl = getServerUrl()): Promise<boolean> => {
    try {
      const res = await doFetch(`${serverUrl.trim().replace(/\/+$/, '')}/api/health`, { method: 'GET' }, QUICK_TIMEOUT_MS);
      return res.ok;
    } catch {
      return false;
    }
  },

  signup: (email: string, display_name: string, password: string) =>
    request<AuthResponse>('POST', '/auth/signup', { email, display_name, password }),
  login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<User>('GET', '/me', undefined, QUICK_TIMEOUT_MS),
  /** Comptes inscrits sur le serveur (choix des personnes à inviter dans un pool). */
  listUsers: () => request<User[]>('GET', '/users'),

  listPools: () => request<Pool[]>('GET', '/pools'),
  createPool: (name: string) => request<Pool>('POST', '/pools', { name }),
  getPool: (id: number) => request<ScopeDetail>('GET', `/pools/${id}`),
  renamePool: (id: number, name: string) => request<Pool>('PATCH', `/pools/${id}`, { name }),
  deletePool: (id: number) => request<void>('DELETE', `/pools/${id}`),

  addMember: (poolId: number, email: string) => request<Member>('POST', `/pools/${poolId}/members`, { email }),
  removeMember: (poolId: number, userId: number) => request<void>('DELETE', `/pools/${poolId}/members/${userId}`),

  listProjects: () => request<Project[]>('GET', '/projects'),
  createProject: (input: CreateProject) => request<Project>('POST', '/projects', input),
  getProject: (id: number) => request<ScopeDetail>('GET', `/projects/${id}`),
  updateProject: (id: number, patch: UpdateProject) => request<Project>('PATCH', `/projects/${id}`, patch),
  deleteProject: (id: number) => request<void>('DELETE', `/projects/${id}`),

  createPoolState: (poolId: number, input: CreateState) => request<State>('POST', `/pools/${poolId}/states`, input),
  createProjectState: (projectId: number, input: CreateState) => request<State>('POST', `/projects/${projectId}/states`, input),
  updateState: (id: number, patch: UpdateState) => request<State>('PATCH', `/states/${id}`, patch),
  deleteState: (id: number) => request<void>('DELETE', `/states/${id}`),

  createPoolType: (poolId: number, input: CreateCardType) => request<CardType>('POST', `/pools/${poolId}/types`, input),
  createProjectType: (projectId: number, input: CreateCardType) => request<CardType>('POST', `/projects/${projectId}/types`, input),
  updateType: (id: number, patch: UpdateCardType) => request<CardType>('PATCH', `/types/${id}`, patch),
  /** Les cartes de ce type repassent sans type. */
  deleteType: (id: number) => request<void>('DELETE', `/types/${id}`),

  createCard: (projectId: number, input: CreateCard) => request<Card>('POST', `/projects/${projectId}/cards`, input),
  getCard: (id: number) => request<Card>('GET', `/cards/${id}`),
  updateCard: (id: number, patch: UpdateCard) => request<Card>('PATCH', `/cards/${id}`, patch),
  setAssignees: (id: number, assignees: AssigneeInput[]) => request<Card>('PUT', `/cards/${id}/assignees`, assignees),
  deleteCard: (id: number) => request<void>('DELETE', `/cards/${id}`),

  // Pauses d'un assigné : chaque route renvoie la carte complète, planifications recalculées.
  /** Pause à partir de `date` (aujourd'hui par défaut) ; 409 si déjà en pause. */
  pauseAssignee: (cardId: number, userId: number, date?: string) =>
    request<Card>('POST', `/cards/${cardId}/assignees/${userId}/pause`, (date ? { date } : {}) satisfies PauseDate),
  /** Reprise le jour `date` (aujourd'hui par défaut) ; 409 sans pause en cours. */
  resumeAssignee: (cardId: number, userId: number, date?: string) =>
    request<Card>('POST', `/cards/${cardId}/assignees/${userId}/resume`, (date ? { date } : {}) satisfies PauseDate),
  /** `end_date: null` rouvre la pause. */
  updatePause: (id: number, patch: UpdatePause) => request<Card>('PATCH', `/pauses/${id}`, patch),
  deletePause: (id: number) => request<Card>('DELETE', `/pauses/${id}`),

  /** Commentaires d'une carte, du plus ancien au plus récent. */
  listComments: (cardId: number) => request<Comment[]>('GET', `/cards/${cardId}/comments`),
  createComment: (cardId: number, body: string) => request<Comment>('POST', `/cards/${cardId}/comments`, { body }),
  /** Auteur seulement. */
  updateComment: (id: number, body: string) => request<Comment>('PATCH', `/comments/${id}`, { body }),
  /** Auteur, propriétaire du projet ou du pool. */
  deleteComment: (id: number) => request<void>('DELETE', `/comments/${id}`)
};
