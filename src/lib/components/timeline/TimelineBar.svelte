<!--
  Barre d'une carte planifiée, ou part d'un assigné (carte à plusieurs personnes : une barre par personne,
  avec son avatar ; déplacer une part change la date de début de cette personne seulement).
  Glisser pour replanifier : capture du pointeur, déplacement en transform seul (aucun recalcul de mise en page),
  aimanté au jour, bulle de dates au-dessus ; au relâchement la barre se pose en douceur à sa nouvelle place.
  Échap annule (retour immédiat : action clavier). Clavier : Entrée ouvre, ←/→ décale d'un jour ouvré (Maj : 5), sans animation.
  L'état du drag reste local à la barre : les autres lignes ne sont pas re-rendues pendant le geste.
  Jours de pause compris dans la barre : hachures diagonales (une pause en cours, jusqu'à aujourd'hui inclus).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { addWorkingDays, formatLong, pausedRanges } from '$lib/dates';
  import { fmtPct } from '$lib/format';
  import { reducedMotion } from '$lib/motion';
  import { priority } from '$lib/priority';
  import { board } from '$lib/stores/board.svelte';
  import {
    formatDayRange,
    HEADER_HEIGHT,
    LABEL_WIDTH,
    laneBox,
    shiftSchedule,
    subWorkingDays,
    textWidth,
    type Segment,
    type TimelineRow
  } from './timeline';

  let {
    row,
    segment,
    rangeStart,
    rangeEnd,
    dayWidth,
    onopen,
    onmove,
    onhover,
    onleave,
    ondragstate
  }: {
    row: TimelineRow;
    segment: Segment;
    rangeStart: number;
    rangeEnd: number;
    dayWidth: number;
    onopen: () => void;
    /** Nouveau jour de début demandé (`viaKeyboard` : pas d'animation de réordonnancement) */
    onmove: (start: number, viaKeyboard: boolean) => void;
    onhover: (anchor: DOMRect, pointerX: number) => void;
    onleave: () => void;
    ondragstate: (dragging: boolean) => void;
  } = $props();

  /** En deçà, un appui-relâché est un clic. */
  const DRAG_THRESHOLD = 4;
  /** Zone (px) près des bords où le glisser fait défiler la grille. */
  const EDGE = 48;
  const EDGE_SPEED = 16;
  const SETTLE_MS = 150;
  const CANCEL_MS = 130;

  let el: HTMLDivElement;

  const card = $derived(row.card);
  const left = $derived((segment.start - rangeStart) * dayWidth);
  const width = $derived((segment.end - segment.start + 1) * dayWidth);
  const box = $derived(laneBox(segment.lane, row.lanes));
  /** Part d'une carte à plusieurs assignés, sur la ligne de la carte : avatar de la personne (et son nom s'il tient). */
  const split = $derived(row.split);
  const person = $derived(segment.userId != null ? card.assignees.find((a) => a.user_id === segment.userId) : undefined);
  const personName = $derived(segment.userId != null ? (board.member(segment.userId)?.display_name ?? 'Ancien membre') : '');
  const color = $derived(priority(card.priority).color);
  // Dans un pool, le liseré gauche (3 px) porte la couleur du projet ; le fond et le contour restent ceux de la priorité.
  // Barre trop étroite (zoom « Mois ») : le liseré la mangerait, on garde la priorité seule.
  const project = $derived(board.kind === 'pool' ? board.projectOf(card.project_id) : undefined);
  const stripe = $derived(project && width >= 12 ? project.color : null);
  const ref = $derived(board.cardKey(card));
  // Ligne d'une personne (regroupement par assigné) : son seul avatar ; sinon ceux de la carte.
  const people = $derived(person && !split ? [person] : card.assignees.slice(0, 3));
  const extra = $derived(person && !split ? 0 : card.assignees.length - people.length);
  const avatarsWidth = $derived(people.length ? 16 + (people.length - 1) * 13 + (extra > 0 ? 19 : 0) + 6 : 0);
  /** Avatar d'une part : 16 px sur une rangée pleine, à la hauteur de la rangée quand les parts s'empilent. */
  const avatarSize = $derived(row.lanes > 1 ? Math.max(8, Math.min(14, box.height)) : 16);
  // Titre dans la barre s'il y tient (ou si la barre est assez large pour un début lisible), sinon à droite.
  // Part d'une carte : avatar (et prénom sur une rangée pleine) dedans s'il tient, sinon juste après.
  const inside = $derived(
    split ? width >= avatarSize + 10 : width >= Math.min(textWidth(card.title) + 18, 88) + avatarsWidth
  );
  const showName = $derived(split && row.lanes === 1 && width >= avatarSize + textWidth(personName) + 22);
  const when = $derived(
    segment.start === segment.end
      ? `le ${formatLong(segment.start)}`
      : `du ${formatLong(segment.start)} au ${formatLong(segment.end)}`
  );
  /** Morceaux de la barre en pause (px depuis son bord gauche) ; le liseré gauche (3 px) reste visible. */
  const hatches = $derived(
    pausedRanges(segment.start, segment.end, segment.pauses).map((r) => {
      const x = (r.start - segment.start) * dayWidth;
      const left = Math.max(x, 3);
      return { key: r.start, left, width: Math.max(1, (r.end - r.start + 1) * dayWidth - (left - x)) };
    })
  );
  const pausedDays = $derived(person ? (person.schedule?.paused_days ?? 0) : (card.assignees[0]?.schedule?.paused_days ?? 0));
  const ariaLabel = $derived(
    (person
      ? `${ref} ${card.title}, part de ${personName} (${fmtPct(Math.round(person.pct * 100) / 100)}), ${when}`
      : `${ref} ${card.title}, ${when}`) + (hatches.length && pausedDays > 0 ? `, dont ${pausedDays} jour${pausedDays > 1 ? 's' : ''} de pause` : '')
  );

  // ---------- Drag ----------

  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let originScroll = 0;
  let lastX = 0;
  let lastY = 0;
  /** Pointeur fin au-dessus de la barre (infobulle demandée) */
  let hovered = false;
  let scroller: HTMLElement | null = null;
  let raf = 0;

  let moved = $state(false);
  let delta = $state(0);
  let pillBelow = $state(false);
  const preview = $derived(moved ? shiftSchedule(segment.start, segment.workingDays, delta, segment.pauses) : null);

  function snapMs(): number {
    // Aimanter par pas de 40 px est sec : un très court ease-out lisse les pas (transition CSS, interruptible).
    return dayWidth >= 16 && !reducedMotion() ? 90 : 0;
  }

  function onpointerdown(e: PointerEvent) {
    // Un seul pointeur à la fois : un second doigt ne doit pas faire sauter la barre.
    if (pointerId !== null || !e.isPrimary || e.button !== 0 || e.ctrlKey || e.metaKey) return;
    onleave();
    pointerId = e.pointerId;
    originX = lastX = e.clientX;
    originY = lastY = e.clientY;
    scroller = el.closest<HTMLElement>('[data-tl-scroller]');
    originScroll = scroller?.scrollLeft ?? 0;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché : le geste continue sans capture */
    }
    window.addEventListener('keydown', onWindowKeydown, true);
    scroller?.addEventListener('scroll', update, { passive: true });
  }

  function onpointermove(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    lastX = e.clientX;
    lastY = e.clientY;
    update();
    autoScroll();
  }

  function begin() {
    moved = true;
    const top = scroller ? scroller.getBoundingClientRect().top + HEADER_HEIGHT : 0;
    pillBelow = el.getBoundingClientRect().top - 34 < top;
    const ms = snapMs();
    el.style.transition = ms ? `transform ${ms}ms var(--ease-out)` : 'none';
    el.style.willChange = 'transform';
    ondragstate(true);
  }

  function update() {
    if (pointerId === null) return;
    const scrolled = (scroller?.scrollLeft ?? 0) - originScroll;
    if (!moved) {
      // Distance sur les deux axes : appuyer, partir loin à la verticale puis relâcher n'est pas un clic
      // (la capture du pointeur livrerait le pointerup à la barre et ouvrirait la carte).
      if (Math.hypot(lastX - originX, lastY - originY) < DRAG_THRESHOLD && scrolled === 0) return;
      begin();
    }
    const raw = Math.round((lastX - originX + scrolled) / dayWidth);
    const d = Math.max(rangeStart - segment.start, Math.min(rangeEnd - segment.end, raw));
    if (d !== delta) {
      delta = d;
      el.style.transform = `translateX(${d * dayWidth}px)`;
    }
  }

  function edgeVelocity(): number {
    if (!scroller) return 0;
    const r = scroller.getBoundingClientRect();
    const l = r.left + LABEL_WIDTH;
    if (lastX < l + EDGE) return -EDGE_SPEED * Math.min(1, (l + EDGE - lastX) / EDGE);
    if (lastX > r.right - EDGE) return EDGE_SPEED * Math.min(1, (lastX - (r.right - EDGE)) / EDGE);
    return 0;
  }

  function autoScroll() {
    if (raf || !moved) return;
    const step = () => {
      raf = 0;
      if (pointerId === null || !scroller) return;
      const v = edgeVelocity();
      if (!v) return;
      scroller.scrollLeft += v; // l'évènement scroll recalcule la position
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function finish() {
    const id = pointerId;
    pointerId = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('keydown', onWindowKeydown, true);
    scroller?.removeEventListener('scroll', update);
    if (id !== null && el?.hasPointerCapture(id)) el.releasePointerCapture(id);
    if (el) el.style.willChange = '';
    if (moved) {
      moved = false;
      ondragstate(false);
    }
    delta = 0;
  }

  /**
   * Retour à la place d'origine. Geste au pointeur (lâchée sur place, pointeur perdu) : ease-out rapide,
   * retargeté depuis la position courante. Échap : immédiat, une action clavier ne s'anime jamais.
   */
  function returnHome(animate: boolean) {
    el.style.transition = animate && !reducedMotion() ? `transform ${CANCEL_MS}ms var(--ease-out)` : 'none';
    el.style.transform = '';
  }

  /** La barre a changé de `left` : on repart de là où l'œil la voyait et on la pose (FLIP horizontal). */
  function settleFrom(offsetPx: number) {
    el.style.transition = 'none';
    if (!offsetPx || reducedMotion()) {
      el.style.transform = '';
      return;
    }
    el.style.transform = `translateX(${offsetPx}px)`;
    void el.offsetWidth;
    el.style.transition = `transform ${SETTLE_MS}ms var(--ease-out)`;
    el.style.transform = '';
  }

  async function onpointerup(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    const wasMoved = moved;
    const d = delta;
    const origin = segment.start;
    finish();
    if (!wasMoved) {
      onopen();
      return;
    }
    const target = shiftSchedule(origin, segment.workingDays, d, segment.pauses);
    // Lâchée sur le week-end qui précède son début : même jour ouvré, rien à enregistrer.
    if (d === 0 || target.start === origin) {
      returnHome(true);
      return;
    }
    const hadFocus = document.activeElement === el;
    onmove(target.start, false);
    // Mise à jour optimiste synchrone : après tick() la barre a son nouveau `left`.
    await tick();
    if (!el?.isConnected) return;
    settleFrom((origin + d - segment.start) * dayWidth);
    // Un réordonnancement de la liste déplace le nœud dans le DOM et lui fait perdre le focus (←/→ juste après).
    if (hadFocus && document.activeElement !== el) el.focus({ preventScroll: true });
  }

  function onpointerlost(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    const wasMoved = moved;
    finish();
    if (wasMoved) returnHome(true);
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const wasMoved = moved;
    finish();
    if (wasMoved) returnHome(false);
  }

  $effect(() => () => {
    finish();
    // Barre retirée sous le pointeur (groupe replié au clavier, carte supprimée…) : aucun pointerleave
    // ne viendra, l'infobulle en attente ou ouverte resterait affichée.
    if (hovered) onleave();
  });

  // ---------- Survol (infobulle, pointeurs fins uniquement) ----------

  function onpointerenter(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || pointerId !== null) return;
    hovered = true;
    onhover(el.getBoundingClientRect(), e.clientX);
  }

  function onpointerleave() {
    hovered = false;
    if (pointerId === null) onleave();
  }

  // ---------- Clavier : instantané, jamais animé ----------

  async function onkeydown(e: KeyboardEvent) {
    if (pointerId !== null) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onopen();
      return;
    }
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const n = e.shiftKey ? 5 : 1;
    const start = e.key === 'ArrowRight' ? addWorkingDays(segment.start, n) : subWorkingDays(segment.start, n);
    el.style.transition = 'none';
    el.style.transform = '';
    onmove(start, true);
    await tick();
    if (!el?.isConnected) return;
    // Un réordonnancement de la liste déplace le nœud dans le DOM et lui fait perdre le focus.
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
</script>

<div
  bind:this={el}
  class="bar"
  class:dragging={moved}
  class:outside={!inside}
  class:split
  class:stacked={row.lanes > 1}
  data-card-id={card.id}
  style:left="{left}px"
  style:width="{width}px"
  style:top="{box.top}px"
  style:height="{box.height}px"
  style:--c={color}
  style:--stripe={stripe}
  role="button"
  tabindex="0"
  aria-label={ariaLabel}
  aria-roledescription="barre déplaçable"
  aria-keyshortcuts="Enter ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerlost}
  onlostpointercapture={onpointerlost}
  {onpointerenter}
  {onpointerleave}
  {onkeydown}
>
  {#each hatches as h (h.key)}
    <span class="pause" style:left="{h.left}px" style:width="{h.width}px" aria-hidden="true"></span>
  {/each}
  {#if split}
    {#if inside}
      {@render own()}
    {:else}
      <span class="out" aria-hidden="true">{@render own()}</span>
    {/if}
  {:else if inside}
    <span class="title">{card.title}</span>
    {@render avatars()}
  {:else}
    <span class="out" aria-hidden="true">
      <span class="title">{card.title}</span>
      {@render avatars()}
    </span>
  {/if}
  {#if preview}
    <span class="pill num" class:below={pillBelow} aria-hidden="true">
      {formatDayRange(preview.start, preview.end)}
    </span>
  {/if}
</div>

{#snippet own()}
  {#if segment.userId != null}
    <span class="people">
      <Avatar id={segment.userId} name={personName} size={avatarSize} ring={row.lanes > 1} />
    </span>
    {#if showName}<span class="title">{personName}</span>{/if}
  {/if}
{/snippet}

{#snippet avatars()}
  {#if people.length}
    <span class="people">
      {#each people as a (a.user_id)}
        <Avatar id={a.user_id} name={board.member(a.user_id)?.display_name ?? 'Ancien membre'} size={16} ring />
      {/each}
      {#if extra > 0}
        <span class="more num">+{extra}</span>
      {/if}
    </span>
  {/if}
{/snippet}

<style>
  .bar {
    --fill: 16%;
    position: absolute;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 0 9px;
    border-radius: var(--radius-sm);
    /* Fond opaque (mélangé à la surface) : la grille ne transparaît pas ; liseré plein à gauche. */
    background: color-mix(in srgb, var(--c) var(--fill), var(--surface));
    box-shadow:
      inset 3px 0 0 var(--stripe, var(--c)),
      inset 0 0 0 1px color-mix(in srgb, var(--c) 32%, transparent);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    cursor: grab;
    touch-action: pan-y;
  }

  /* Cible élargie à toute la hauteur de la ligne (+4 px de part et d'autre) : au zoom « Mois »,
     une carte d'un jour ne fait que 5 px de large. */
  .bar::before {
    content: '';
    position: absolute;
    inset: -6px -4px;
  }

  .bar.outside {
    padding: 0;
  }

  /*
   * Jours de pause : la barre « s'évide » (fond de surface) sous des hachures diagonales de sa couleur, atténuée.
   * z-index négatif dans le contexte d'empilement de la barre : sous le titre et les avatars, au-dessus du fond.
   */
  .pause {
    position: absolute;
    top: 1px;
    bottom: 1px;
    z-index: -1;
    border-radius: 2px;
    background:
      repeating-linear-gradient(
        -45deg,
        color-mix(in srgb, var(--c) 30%, transparent) 0 2px,
        transparent 2px 6px
      ),
      color-mix(in srgb, var(--c) 5%, var(--surface));
    pointer-events: none;
  }

  /* Part d'un assigné : avatar en tête, juste après le liseré. */
  .bar.split {
    gap: 5px;
    padding: 0 4px 0 6px;
  }

  /* Parts empilées : rangées fines, rayon réduit ; la cible ne déborde pas sur la rangée voisine. */
  .bar.stacked {
    padding-left: 5px;
    border-radius: 3px;
  }

  .bar.stacked::before {
    inset: -1px -4px;
  }

  /* Part trop étroite pour son avatar : il passe juste après (aucun retrait qui élargirait la barre). */
  .bar.split.outside,
  .bar.stacked.outside {
    padding: 0;
  }

  .bar:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Teinte : repos < survol < glisser. L'ordre compte (même spécificité) : le glisser vient après le survol,
     sinon une barre tenue (donc survolée) retomberait à la teinte de survol. */
  @media (hover: hover) and (pointer: fine) {
    .bar:hover {
      --fill: 21%;
    }
    .bar:hover .out {
      color: var(--text);
    }
  }

  .bar.dragging {
    --fill: 22%;
    z-index: 2;
    cursor: grabbing;
    box-shadow:
      inset 3px 0 0 var(--stripe, var(--c)),
      inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent),
      var(--shadow-md);
  }

  @media (prefers-color-scheme: dark) {
    .bar {
      --fill: 24%;
    }
  }
  @media (prefers-color-scheme: dark) and (hover: hover) and (pointer: fine) {
    .bar:hover {
      --fill: 30%;
    }
  }
  @media (prefers-color-scheme: dark) {
    .bar.dragging {
      --fill: 32%;
    }
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Pas d'infobulle native sur les avatars : elle doublerait l'infobulle de la barre. */
  .people {
    display: flex;
    flex: none;
    align-items: center;
    pointer-events: none;
  }

  .people > :global(:not(:first-child)) {
    margin-left: -3px;
  }

  .more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-muted);
    font-size: 9px;
    font-weight: 600;
    box-shadow: 0 0 0 2px var(--surface);
  }

  /* Barre trop courte : titre et avatars à droite. Le libellé fait partie de la cible (survol, clic, glisser) ;
     le retrait est un padding, pas un décalage, pour qu'aucun trou entre barre et libellé ne ferme l'infobulle. */
  .out {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 286px;
    padding-left: 6px;
    white-space: nowrap;
    color: var(--text-muted);
  }

  /* Bulle de dates pendant le glisser : apparaît depuis la barre (@starting-style), fondu + léger scale. */
  .pill {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    background: var(--text);
    color: var(--surface);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
    box-shadow: var(--shadow-md);
    pointer-events: none;
    transform-origin: bottom left;
    transition:
      opacity 120ms var(--ease-out),
      transform 120ms var(--ease-out);
  }

  .pill.below {
    top: calc(100% + 6px);
    bottom: auto;
    transform-origin: top left;
  }

  @starting-style {
    .pill {
      opacity: 0;
      transform: translateY(2px) scale(0.97);
    }
    .pill.below {
      transform: translateY(-2px) scale(0.97);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    @starting-style {
      .pill,
      .pill.below {
        transform: none;
      }
    }
  }
</style>
