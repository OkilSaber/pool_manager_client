// Accueil : glisser-déposer des projets entre pools (événements pointeur, pas de HTML5 draggable —
// peu fiable dans la webview Tauri), contexte partagé par les tuiles, et mémoire des pools dépliés.

import { getContext, setContext } from 'svelte';
import { reducedMotion } from '$lib/motion';
import type { Project } from '$lib/types/Project';

/** Cible de dépôt : id de pool, ou null pour « Projets sans pool » (détacher). */
export type DropKey = number | null;

/** Attribut posé sur les zones de dépôt : `pool:<id>` ou `none`. */
export const DROP_ATTR = 'data-drop';

export function dropAttr(key: DropKey): string {
  return key === null ? 'none' : `pool:${key}`;
}

function parseDrop(value: string | null): DropKey | undefined {
  if (value === 'none') return null;
  const m = value?.match(/^pool:(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

/** Distance (px) avant que l'appui ne devienne un glissement : en deçà, c'est un clic. */
const THRESHOLD = 4;
/** Retour du fantôme quand on annule (Échap, dépôt hors cible). */
export const RETURN_MS = 200;
/** Disparition du fantôme sur une cible valide : plus courte que l'entrée. */
export const DROP_MS = 130;
/** Défilement automatique près des bords du conteneur. */
const EDGE = 56;
const MAX_SPEED = 14;

type Phase = 'idle' | 'dragging' | 'returning' | 'dropping';

export interface DragOptions {
  /** Le projet peut-il être déposé sur cette cible ? (droits + cible différente de l'origine) */
  canDrop: (project: Project, key: DropKey) => boolean;
  onDrop: (project: Project, key: DropKey) => void;
  /** Conteneur qui défile (défilement automatique près des bords). */
  scroller: () => HTMLElement | undefined;
}

interface Pending {
  pointerId: number;
  x0: number;
  y0: number;
  project: Project;
  el: HTMLElement;
}

export class ProjectDrag {
  phase = $state<Phase>('idle');
  /** Projet glissé (dès le seuil franchi, jusqu'à la fin de l'animation de retour/dépôt). */
  project = $state<Project | null>(null);
  /** Point de saisie (coordonnées viewport) : origine du fantôme. */
  x0 = $state(0);
  y0 = $state(0);
  /** Déplacement depuis la saisie : seule une translation est appliquée au fantôme. */
  dx = $state(0);
  dy = $state(0);
  /** Cible survolée (undefined : aucune, ou l'origine du projet). */
  over = $state<DropKey | undefined>(undefined);
  /** La cible survolée accepte-t-elle le projet ? */
  allowed = $state(false);

  private pending: Pending | null = null;
  private lastX = 0;
  private lastY = 0;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private opts: DragOptions) {}

  get active(): boolean {
    return this.phase === 'dragging';
  }

  /** État visuel d'une cible pendant le glissement. */
  stateOf(key: DropKey): 'over' | 'can' | 'denied' | undefined {
    const p = this.project;
    if (!p || this.phase !== 'dragging') return undefined;
    if (key === p.pool_id) return undefined; // origine : neutre
    const ok = this.opts.canDrop(p, key);
    if (this.over === key) return ok ? 'over' : 'denied';
    return ok ? 'can' : undefined;
  }

  /** À brancher sur `onpointerdown` d'une source glissable. */
  start = (e: PointerEvent, project: Project) => {
    if (this.pending || this.phase === 'dragging') return;
    // Bouton principal uniquement, pointeur principal, sans modificateur (Ctrl+clic = menu contextuel sur macOS).
    if (e.button !== 0 || !e.isPrimary || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (this.phase !== 'idle') this.reset(); // un retour en cours est interrompu net
    this.pending = {
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      project,
      el: e.currentTarget as HTMLElement
    };
    window.addEventListener('pointermove', this.onmove, true);
    window.addEventListener('pointerup', this.onup, true);
    window.addEventListener('pointercancel', this.oncancel, true);
  };

  private begin(p: Pending) {
    try {
      p.el.setPointerCapture(p.pointerId);
    } catch {
      // Pointeur déjà relâché : le pointerup suivant terminera proprement.
    }
    window.getSelection()?.removeAllRanges();
    this.project = p.project;
    this.x0 = p.x0;
    this.y0 = p.y0;
    this.phase = 'dragging';
    document.documentElement.classList.add('pm-dragging');
    window.addEventListener('keydown', this.onkeydown, true);
    window.addEventListener('blur', this.onblur);
    this.raf = requestAnimationFrame(this.autoscroll);
  }

  private onmove = (e: PointerEvent) => {
    const p = this.pending;
    if (!p || e.pointerId !== p.pointerId) return; // pointeurs secondaires ignorés
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (this.phase !== 'dragging') {
      if (Math.hypot(dx, dy) < THRESHOLD) return;
      this.begin(p);
    }
    e.preventDefault();
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.dx = dx;
    this.dy = dy;
    this.hitTest();
  };

  private hitTest() {
    const p = this.project;
    if (!p) return;
    const el = document.elementFromPoint(this.lastX, this.lastY);
    const zone = el?.closest(`[${DROP_ATTR}]`);
    let key = parseDrop(zone?.getAttribute(DROP_ATTR) ?? null);
    if (key === p.pool_id) key = undefined;
    this.over = key;
    this.allowed = key !== undefined && this.opts.canDrop(p, key);
    document.documentElement.classList.toggle('pm-drag-denied', key !== undefined && !this.allowed);
  }

  private onup = (e: PointerEvent) => {
    const p = this.pending;
    if (!p || e.pointerId !== p.pointerId) return;
    if (this.phase !== 'dragging') {
      this.detach(); // simple clic : la navigation suit son cours
      return;
    }
    swallowNextClick();
    const project = this.project!;
    const key = this.over;
    if (key !== undefined && this.allowed) {
      this.finish('dropping', DROP_MS);
      this.opts.onDrop(project, key);
    } else {
      this.cancel();
    }
  };

  private oncancel = (e: PointerEvent) => {
    if (!this.pending || e.pointerId !== this.pending.pointerId) return;
    if (this.phase === 'dragging') this.cancel();
    else this.detach();
  };

  private onkeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.cancel();
  };

  private onblur = () => this.cancel();

  /** Annule : le fantôme revient vers son point de saisie (ease-out rapide). */
  cancel() {
    if (this.phase !== 'dragging') return;
    // Mouvement réduit : pas de trajet retour, le fantôme s'efface sur place.
    const still = reducedMotion();
    if (!still) {
      this.dx = 0;
      this.dy = 0;
    }
    this.finish('returning', still ? DROP_MS : RETURN_MS);
  }

  private finish(phase: 'returning' | 'dropping', ms: number) {
    const el = this.pending?.el;
    const id = this.pending?.pointerId;
    if (el && id !== undefined && el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
    this.detach();
    this.over = undefined;
    this.allowed = false;
    this.phase = phase;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reset(), ms);
  }

  private detach() {
    this.pending = null;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onmove, true);
    window.removeEventListener('pointerup', this.onup, true);
    window.removeEventListener('pointercancel', this.oncancel, true);
    window.removeEventListener('keydown', this.onkeydown, true);
    window.removeEventListener('blur', this.onblur);
    document.documentElement.classList.remove('pm-dragging', 'pm-drag-denied');
  }

  private reset() {
    clearTimeout(this.timer);
    this.phase = 'idle';
    this.project = null;
    this.dx = 0;
    this.dy = 0;
  }

  /** Défilement automatique quand le pointeur approche du haut ou du bas du conteneur. */
  private autoscroll = () => {
    if (this.phase !== 'dragging') return;
    const box = this.opts.scroller();
    if (box) {
      const r = box.getBoundingClientRect();
      let v = 0;
      if (this.lastY < r.top + EDGE) v = -((r.top + EDGE - this.lastY) / EDGE);
      else if (this.lastY > r.bottom - EDGE) v = (this.lastY - (r.bottom - EDGE)) / EDGE;
      if (v !== 0) {
        const before = box.scrollTop;
        box.scrollTop += Math.max(-1, Math.min(1, v)) * MAX_SPEED;
        if (box.scrollTop !== before) this.hitTest();
      }
    }
    this.raf = requestAnimationFrame(this.autoscroll);
  };

  destroy() {
    this.detach();
    this.reset();
  }
}

/** Après un glissement, le clic qui suit le relâchement ne doit pas ouvrir le lien saisi. */
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

// ---------- Contexte partagé par les tuiles ----------

export interface MoveTarget {
  key: DropKey;
  label: string;
}

export interface HomeContext {
  drag: ProjectDrag;
  /** Destinations autorisées pour ce projet (hors sa position actuelle). */
  targets: (project: Project) => MoveTarget[];
  canDrag: (project: Project) => boolean;
  /** Ouvre les réglages du projet (ProjectFormDialog en édition). */
  openSettings: (project: Project) => void;
  move: (project: Project, key: DropKey, viaKeyboard: boolean) => void;
  /** Menu « … » ouvert (une seule clé à la fois : `pool:<id>` ou `project:<id>`). */
  menuFor: () => string | null;
  setMenu: (key: string | null) => void;
}

const KEY = Symbol('home');

export function setHomeContext(ctx: HomeContext) {
  setContext(KEY, ctx);
}

export function getHomeContext(): HomeContext {
  return getContext<HomeContext>(KEY);
}

/** Gestion clavier / clic droit commune aux projets : Maj+F10 ou touche Menu ouvre les réglages. */
export function projectKeys(ctx: HomeContext, project: Project) {
  return {
    oncontextmenu: (e: MouseEvent) => {
      e.preventDefault();
      if (ctx.drag.phase !== 'idle') return;
      ctx.openSettings(project);
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        ctx.openSettings(project);
      }
    },
    ondragstart: (e: DragEvent) => e.preventDefault(),
    onpointerdown: (e: PointerEvent) => {
      if (ctx.canDrag(project)) ctx.drag.start(e, project);
    }
  };
}

// ---------- Pools dépliés (mémorisés) ----------

const EXPANDED_KEY = 'pm.home.expanded';

export function loadExpanded(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function saveExpanded(ids: Iterable<number>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch {
    // Stockage indisponible : l'état ne survivra pas au rechargement, sans gravité.
  }
}
