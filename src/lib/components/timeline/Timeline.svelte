<!--
  Vue « Chronologie » d'un tableau (lit le store `board`).
  Un seul conteneur défilant dans les deux sens ; colonne des libellés et en-tête collants (CSS sticky).
  Mouvement : réservé à ce qui l'explique (barre qui se pose, ligne qui change de place, infobulle) ;
  rien d'animé pour les actions clavier.
-->
<script module lang="ts">
  import { SvelteMap } from 'svelte/reactivity';

  /** Groupes repliés : gardés en mémoire le temps de la session, par tableau (pool ou projet). */
  const collapsedGroups = new SvelteMap<string, boolean>();
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { AnimationConfig } from 'svelte/animate';
  import { quartInOut } from 'svelte/easing';
  import { formatLong, fromDay, nextWorkingDay, today, toDay } from '$lib/dates';
  import { DUR, easeOut, reducedMotion } from '$lib/motion';
  import { PRIORITIES } from '$lib/priority';
  import { board } from '$lib/stores/board.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { tooltip } from '$lib/tooltip';
  import TimelineGrid from './TimelineGrid.svelte';
  import TimelineGroupHeader from './TimelineGroupHeader.svelte';
  import TimelineHeader from './TimelineHeader.svelte';
  import TimelineRow from './TimelineRow.svelte';
  import Tooltip from './Tooltip.svelte';
  import UnplannedRow from './UnplannedRow.svelte';
  import {
    buildGroups,
    computeRange,
    dayWidthOf,
    formatRange,
    GROUP_BYS,
    GROUP_HEIGHT,
    GROUP_KEY,
    HEADER_HEIGHT,
    isGroupBy,
    isZoom,
    LABEL_WIDTH,
    plural,
    readPref,
    resolveGroupBy,
    ROW_HEIGHT,
    unplannedRows,
    writePref,
    ZOOM_KEY,
    ZOOMS,
    type GroupBy,
    type Zoom
  } from './timeline';

  let { onopencard }: { onopencard: (cardId: number) => void } = $props();

  let zoom = $state<Zoom>(readPref(ZOOM_KEY, isZoom, 'week'));
  /** Regroupement choisi (enregistré) ; null : rien d'enregistré, défaut selon le type de tableau. */
  let groupPref = $state<GroupBy | null>(readPref<GroupBy | null>(GROUP_KEY, (v): v is GroupBy => isGroupBy(v), null));
  let todayDay = $state(today());
  let scroller = $state<HTMLDivElement>();
  let viewportW = $state(0);
  let dragging = $state(false);
  let announcement = $state('');

  /** « Projet » n'a de sens que dans un pool (une vue projet n'en montre qu'un). */
  const groupOptions = $derived(GROUP_BYS.filter((g) => g.value !== 'project' || board.kind === 'pool'));
  const groupBy = $derived(resolveGroupBy(groupPref, board.kind));
  /** Zone gardée dans la plage après un changement de zoom (sinon la date ancrée pourrait en sortir). */
  let keep = $state<{ from: number; to: number } | null>(null);

  const dayWidth = $derived(dayWidthOf(zoom));
  // Assez de jours pour remplir la largeur visible quel que soit le zoom, et pour pouvoir placer aujourd'hui au quart gauche.
  const visibleDays = $derived(Math.ceil(Math.max(0, viewportW - LABEL_WIDTH) / dayWidth));
  const range = $derived(
    computeRange(
      board.visibleCards,
      todayDay,
      visibleDays + 14,
      Math.ceil(visibleDays / 4) + 1,
      Math.ceil((visibleDays * 3) / 4) + 7,
      keep
    )
  );
  const gridWidth = $derived(range.days * dayWidth);
  const groups = $derived(buildGroups(board.visibleCards, board.states, board.members, board.projects, groupBy));
  const unplanned = $derived(unplannedRows(board.visibleCards, board.states));
  const plannedCount = $derived(board.visibleCards.length - unplanned.length);
  /** Tableau ouvert (« pool:3 », « project:12 ») : clé des groupes repliés et de la mise en place initiale. */
  const scopeKey = $derived(board.ref ? `${board.ref.kind}:${board.ref.id}` : '');

  $effect(() => writePref(ZOOM_KEY, zoom));

  function setGroupBy(value: string) {
    if (!isGroupBy(value)) return;
    groupPref = value;
    writePref(GROUP_KEY, value);
  }

  // App de bureau laissée ouverte (et au premier plan) au-delà de minuit : la ligne « aujourd'hui » suit.
  // (Le retour au premier plan est couvert par onfocus sur window.)
  $effect(() => {
    const id = setInterval(() => (todayDay = today()), 60_000);
    return () => clearInterval(id);
  });

  // ---------- Groupes repliés ----------

  function isCollapsed(key: string): boolean {
    return collapsedGroups.get(`${scopeKey}:${key}`) === true;
  }

  function toggleGroup(key: string) {
    const k = `${scopeKey}:${key}`;
    collapsedGroups.set(k, !collapsedGroups.get(k));
  }

  // ---------- Défilement ----------

  const visibleGrid = () => Math.max(0, (scroller?.clientWidth ?? 0) - LABEL_WIDTH);

  // Défilement animé maison plutôt que `behavior: 'smooth'` : la durée native dépend de la distance
  // (souvent > 300 ms) et sa courbe n'est pas réglable. Ici : ease-out fort, durée fixe, interrompu
  // dès que l'utilisateur reprend la main (molette, clic, clavier).
  const GLIDE_MS = 240;
  let glideRaf = 0;

  function stopGlide() {
    if (glideRaf) cancelAnimationFrame(glideRaf);
    glideRaf = 0;
  }

  function glideTo(el: HTMLElement, to: number) {
    stopGlide();
    const from = el.scrollLeft;
    const dist = to - from;
    if (Math.abs(dist) < 1) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / GLIDE_MS));
      el.scrollLeft = from + dist * easeOut(p);
      glideRaf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    glideRaf = requestAnimationFrame(step);
  }

  $effect(() => {
    const el = scroller;
    if (!el) return;
    el.addEventListener('wheel', stopGlide, { passive: true });
    el.addEventListener('pointerdown', stopGlide, { passive: true });
    el.addEventListener('keydown', stopGlide);
    return () => {
      el.removeEventListener('wheel', stopGlide);
      el.removeEventListener('pointerdown', stopGlide);
      el.removeEventListener('keydown', stopGlide);
      stopGlide();
    };
  });

  /** Aujourd'hui au quart gauche de la zone visible. */
  function scrollToToday(animate: boolean) {
    if (!scroller) return;
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const left = Math.min(max, Math.max(0, (todayDay - range.start) * dayWidth - visibleGrid() / 4));
    if (animate && !reducedMotion()) {
      glideTo(scroller, left);
    } else {
      stopGlide();
      scroller.scrollLeft = left;
    }
  }

  /**
   * Date gardée immobile par un changement de zoom : aujourd'hui s'il est visible (à la même distance du bord
   * gauche), sinon la date au bord gauche de la zone visible. Appliquée par l'effet ci-dessous, une fois la
   * plage et la largeur du canevas recalculées pour le nouveau zoom.
   */
  let zoomAnchor: { day: number; offset: number } | null = null;

  function setZoom(next: Zoom) {
    if (next === zoom) return;
    stopGlide();
    hideTip();
    const el = scroller;
    if (el) {
      const vis = visibleGrid();
      const todayX = (todayDay - range.start) * dayWidth - el.scrollLeft;
      const leftDay = range.start + el.scrollLeft / dayWidth;
      zoomAnchor = todayX >= 0 && todayX < vis ? { day: todayDay, offset: todayX } : { day: leftDay, offset: 0 };
      // La zone visible au nouveau zoom doit tenir dans la plage, même loin des cartes et d'aujourd'hui.
      const nextVisible = Math.ceil(vis / dayWidthOf(next));
      const from = Math.floor(zoomAnchor.day - zoomAnchor.offset / dayWidthOf(next));
      keep = { from, to: from + nextVisible + 7 };
    }
    zoom = next;
  }

  // Après un changement de zoom : la date ancrée revient à sa place. Sinon, si la plage s'étend vers le passé
  // (carte avancée), on compense le défilement pour que la vue ne saute pas.
  let last: { start: number; dw: number } | null = null;
  $effect(() => {
    const el = scroller;
    const start = range.start;
    const dw = dayWidth;
    void gridWidth; // largeur du canevas à jour avant de fixer scrollLeft
    untrack(() => {
      if (el && last) {
        if (dw !== last.dw && zoomAnchor) {
          el.scrollLeft = (zoomAnchor.day - start) * dw - zoomAnchor.offset;
        } else if (start !== last.start) {
          stopGlide();
          el.scrollLeft += (last.start - start) * dw;
        }
      }
      zoomAnchor = null;
      last = el ? { start, dw } : null;
    });
  });

  // Première mise en place (et changement de tableau) : aujourd'hui en vue, sans animation.
  // Déclaré après la compensation ci-dessus : il a le dernier mot.
  let placedFor: string | null = null;
  $effect(() => {
    const id = scopeKey;
    if (!scroller) {
      placedFor = null;
      return;
    }
    if (viewportW === 0 || placedFor === id) return;
    placedFor = id;
    untrack(() => {
      keep = null;
      scrollToToday(false);
    });
  });

  // ---------- Infobulle : délai à la première, instantanée ensuite ----------

  const TIP_DELAY = 400;
  const TIP_WARM = 300;
  const TIP_WIDTH = 300;

  let tip = $state({ cardId: null as number | null, userId: null as number | null, left: 0, y: 0, below: true, originX: 0 });
  let tipOpen = $state(false);
  let tipInstant = $state(false);
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  let tipClosedAt = -Infinity;
  const tipCard = $derived(tip.cardId != null ? (board.card(tip.cardId) ?? null) : null);

  function showTip(cardId: number, userId: number | null, anchor: DOMRect, x: number) {
    if (dragging) return;
    clearTimeout(tipTimer);
    const below = anchor.bottom + 200 < window.innerHeight;
    const left = Math.round(Math.min(Math.max(8, x - 24), window.innerWidth - TIP_WIDTH - 8));
    tip = {
      cardId,
      userId,
      left,
      y: Math.round(below ? anchor.bottom + 6 : window.innerHeight - anchor.top + 6),
      below,
      originX: Math.round(x - left)
    };
    if (tipOpen || performance.now() - tipClosedAt < TIP_WARM) {
      tipInstant = true;
      tipOpen = true;
    } else {
      tipInstant = false;
      tipTimer = setTimeout(() => (tipOpen = true), TIP_DELAY);
    }
  }

  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipOpen) return;
    tipClosedAt = performance.now();
    tipInstant = false;
    tipOpen = false;
  }

  $effect(() => () => clearTimeout(tipTimer));

  function onDragState(active: boolean) {
    dragging = active;
    if (active) hideTip();
  }

  // ---------- Replanification ----------

  // Réordonnancement des lignes : FLIP (ease-in-out, déplacement à l'écran) pour un geste au pointeur,
  // instantané au clavier ou en mouvement réduit.
  let flipInstant = false;
  const flipParams = () => ({ duration: flipInstant || reducedMotion() ? 0 : DUR.flip, easing: quartInOut });

  /**
   * FLIP vertical seulement. `flip` de Svelte anime aussi x et l'échelle : quand une replanification
   * agrandit la plage (largeur du canevas modifiée) ou la décale vers le passé (défilement compensé),
   * toutes les lignes se seraient étirées / auraient glissé horizontalement pendant l'animation.
   */
  function flipY(
    _node: Element,
    { from, to }: { from: DOMRect; to: DOMRect },
    params: { duration: number; easing: (t: number) => number }
  ): AnimationConfig {
    const dy = from.top - to.top;
    if (!dy || !params.duration) return { duration: 0 };
    return { duration: params.duration, easing: params.easing, css: (_t, u) => `transform: translateY(${u * dy}px);` };
  }

  /**
   * Replanifie une carte (sa date de début) ou, pour la part d'un assigné, la date de début de cette personne :
   * même répartition et mêmes occupations, les autres assignés gardent leur date (propre ou héritée).
   */
  function moveCard(cardId: number, userId: number | null, start: number, viaKeyboard: boolean) {
    flipInstant = viaKeyboard;
    const card = board.card(cardId);
    if (!card) return;
    if (userId == null) {
      void board.updateCard(cardId, { start_date: fromDay(start) });
    } else {
      if (!card.assignees.some((a) => a.user_id === userId)) return;
      void board.setAssignees(
        cardId,
        card.assignees.map((a) => {
          const own = a.user_id === userId ? fromDay(start) : a.start_date;
          return { user_id: a.user_id, pct: a.pct, occupancy: a.occupancy, ...(own ? { start_date: own } : {}) };
        })
      );
    }
    // La mise à jour optimiste est synchrone : la nouvelle planification est déjà là.
    const after = board.card(cardId);
    const s = userId == null ? after?.schedule : after?.assignees.find((a) => a.user_id === userId)?.schedule;
    const a = toDay(s?.start);
    const b = toDay(s?.end);
    if (a == null || b == null) return;
    const who = userId == null ? '' : ` (${board.member(userId)?.display_name ?? 'ancien membre'})`;
    announcement = `Replanifiée${who} : ${formatRange(a, b)}`;
  }

  async function planToday(cardId: number) {
    const start = nextWorkingDay(today());
    flipInstant = false;
    // La mise à jour optimiste (synchrone) retire la ligne « Non planifiées » et son bouton : le focus
    // retomberait sur <body>. On le confie à la barre de la carte, là où elle vient d'apparaître.
    const hadFocus = !!scroller && scroller.contains(document.activeElement);
    const saved = board.updateCard(cardId, { start_date: fromDay(start) });
    if (hadFocus) {
      await tick();
      const bar = scroller?.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`);
      if (bar && !scroller?.contains(document.activeElement)) {
        bar.focus({ preventScroll: true });
        bar.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    if (await saved) toast.success(`Carte planifiée à partir du ${formatLong(start)}`);
  }
</script>

<svelte:window onfocus={() => (todayDay = today())} />

<!-- Pas de nom accessible ici : la page l'enveloppe déjà dans un tabpanel « Chronologie ». -->
<section
  class="timeline"
  style:--row-h="{ROW_HEIGHT}px"
  style:--group-h="{GROUP_HEIGHT}px"
  style:--label-w="{LABEL_WIDTH}px"
>
  {#if !board.detail}
    <div class="center">
      {#if board.loading}<Spinner size={16} label="Chargement de la chronologie" />{/if}
    </div>
  {:else if board.cards.length === 0}
    <div class="center">
      <div class="empty">
        <svg class="empty-art" width="132" height="68" viewBox="0 0 132 68" aria-hidden="true">
          <rect class="b1" x="6" y="8" width="58" height="12" rx="4" />
          <rect class="b2" x="36" y="28" width="70" height="12" rx="4" />
          <rect class="b3" x="20" y="48" width="44" height="12" rx="4" />
          <line x1="84" y1="2" x2="84" y2="66" />
        </svg>
        <h3>Rien à afficher sur la chronologie</h3>
        <p>
          Créez des cartes sur le tableau, puis donnez-leur une date de début et un chiffrage en j/h : elles s'étaleront ici
          dans le temps.
        </p>
      </div>
    </div>
  {:else}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Échelle de temps">
        {#each ZOOMS as z (z.value)}
          <button type="button" class:active={zoom === z.value} aria-pressed={zoom === z.value} onclick={() => setZoom(z.value)}>
            {z.label}
          </button>
        {/each}
      </div>

      <label class="group-by">
        <span>Regrouper par</span>
        <span class="select-wrap">
          <select value={groupBy} onchange={(e) => setGroupBy(e.currentTarget.value)}>
            {#each groupOptions as g (g.value)}
              <option value={g.value}>{g.label}</option>
            {/each}
          </select>
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </label>

      <!-- Clic : court glissé ease-out (il montre dans quel sens on va) ; clavier (detail === 0) : instantané. -->
      <button class="btn btn-sm today-btn" type="button" onclick={(e) => scrollToToday(e.detail !== 0)}>Aujourd'hui</button>

      <ul class="legend" aria-label="Priorités">
        {#each PRIORITIES as p (p.value)}
          <li {@attach tooltip(`${p.label} · ${p.name}`)}><span class="dot" style:background={p.color}></span>{p.label}</li>
        {/each}
      </ul>
    </div>

    <div
      class="scroller"
      data-tl-scroller
      bind:this={scroller}
      bind:clientWidth={viewportW}
      onscroll={hideTip}
      style:scroll-padding-top="{HEADER_HEIGHT}px"
      style:scroll-padding-left="{LABEL_WIDTH}px"
    >
      <div class="canvas" style:width="{LABEL_WIDTH + gridWidth}px">
        <TimelineHeader {range} {zoom} {dayWidth} {todayDay}>
          {#snippet corner()}
            <span class="corner num">{plural(plannedCount, 'carte planifiée', 'cartes planifiées')}</span>
          {/snippet}
        </TimelineHeader>

        <div class="body">
          <TimelineGrid {range} {zoom} {dayWidth} {todayDay} />

          {#if groups.length === 0}
            <div class="row">
              <div class="blank-label"></div>
              <p class="hint" style:left="{LABEL_WIDTH}px">
                {#if board.visibleCards.length === 0}
                  Aucune carte dans les projets affichés.
                {:else}
                  Aucune carte planifiée : il leur faut une date de début et un chiffrage.
                {/if}
              </p>
            </div>
          {/if}

          {#each groups as group, i (group.key)}
            {#if groupBy !== 'none'}
              <div class="row group-row" class:spaced={i > 0}>
                <TimelineGroupHeader
                  kind={groupBy === 'assignee' ? 'assignee' : groupBy === 'project' ? 'project' : 'state'}
                  code={group.code}
                  label={group.label}
                  count={group.rows.length}
                  load={group.load}
                  color={group.color}
                  userId={group.userId}
                  spanStart={group.spanStart}
                  spanEnd={group.spanEnd}
                  rangeStart={range.start}
                  {dayWidth}
                  collapsed={isCollapsed(group.key)}
                  ontoggle={() => toggleGroup(group.key)}
                />
              </div>
            {/if}
            {#if groupBy === 'none' || !isCollapsed(group.key)}
              {#each group.rows as row (row.key)}
                <div class="row card-row" animate:flipY={flipParams()}>
                  <TimelineRow
                    {row}
                    indent={groupBy !== 'none'}
                    rangeStart={range.start}
                    rangeEnd={range.end}
                    {dayWidth}
                    onopen={onopencard}
                    onmove={moveCard}
                    onhover={showTip}
                    onleave={hideTip}
                    ondragstate={onDragState}
                  />
                </div>
              {/each}
            {/if}
          {/each}

          {#if unplanned.length}
            <div class="row group-row" class:spaced={groups.length > 0}>
              <TimelineGroupHeader
                kind="unplanned"
                label="Non planifiées"
                count={unplanned.length}
                rangeStart={range.start}
                {dayWidth}
                collapsed={isCollapsed('unplanned')}
                ontoggle={() => toggleGroup('unplanned')}
              />
            </div>
            {#if !isCollapsed('unplanned')}
              {#each unplanned as item (item.card.id)}
                <div class="row card-row">
                  <UnplannedRow {item} {todayDay} onopen={onopencard} onplan={planToday} />
                </div>
              {/each}
            {/if}
          {/if}

          <div class="filler" aria-hidden="true"><div class="blank-label"></div></div>
        </div>
      </div>
    </div>

    <Tooltip
      card={tipCard}
      userId={tip.userId}
      open={tipOpen && !dragging && tipCard != null}
      instant={tipInstant}
      left={tip.left}
      y={tip.y}
      below={tip.below}
      originX={tip.originX}
    />
    <div class="sr-only" aria-live="polite">{announcement}</div>
  {/if}
</section>

<style>
  .timeline {
    --tl-line: color-mix(in srgb, var(--border) 70%, transparent);
    --tl-line-faint: color-mix(in srgb, var(--border) 45%, transparent);
    /* Même teinte que la piste des en-têtes de groupe (55 %), mais opaque pour la colonne collante. */
    --group-bg: color-mix(in srgb, var(--surface-2) 55%, var(--surface));
    --row-hover: color-mix(in srgb, var(--text) 3.5%, transparent);
    --row-hover-solid: color-mix(in srgb, var(--text) 3.5%, var(--surface));
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }

  /* ---------- Barre d'outils ---------- */

  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 44px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  /* Même rail et même segment actif que le sélecteur de vue de l'en-tête du tableau, en 28 px comme le reste de la barre. */
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--surface-3);
  }

  .seg button {
    height: 24px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition:
      transform var(--dur-press) var(--ease-out),
      color var(--dur-hover) ease;
  }

  .seg button:active {
    transform: scale(0.97);
  }

  .seg button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }

  /* En sombre, --surface est plus foncé que le rail : le segment actif paraîtrait enfoncé. */
  @media (prefers-color-scheme: dark) {
    .seg {
      background: var(--surface-2);
    }
    .seg button.active {
      background: var(--surface-3);
    }
  }

  .seg button:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  .group-by {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .select-wrap select {
    appearance: none;
    height: 28px;
    padding: 0 28px 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition:
      border-color var(--dur-hover) ease,
      box-shadow var(--dur-hover) ease;
  }

  .select-wrap select:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus);
  }

  .select-wrap svg {
    position: absolute;
    right: 10px;
    pointer-events: none;
    color: var(--text-muted);
  }

  /* Toutes les commandes de la barre à 28 px */
  .today-btn {
    height: 28px;
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 0 0 auto;
    padding: 0;
    list-style: none;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .legend .dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
  }

  @media (hover: hover) and (pointer: fine) {
    .seg button:not(.active):hover {
      color: var(--text);
    }
    .select-wrap select:hover {
      border-color: var(--border-strong);
    }
  }

  @media (max-width: 860px) {
    .legend {
      display: none;
    }
  }

  /* ---------- Grille ---------- */

  .scroller {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .canvas {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    min-width: 100%;
  }

  .corner {
    font-size: 12px;
    color: var(--text-muted);
  }

  .body {
    position: relative;
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }

  .row {
    position: relative;
    flex: none;
    display: flex;
    height: var(--row-h);
  }

  .group-row {
    height: var(--group-h);
    background: color-mix(in srgb, var(--surface-2) 55%, transparent);
  }

  /* Filet entre deux groupes, au-dessus de la colonne collante. */
  .group-row.spaced::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 4;
    height: 1px;
    background: var(--border);
  }

  @media (hover: hover) and (pointer: fine) {
    .card-row:hover {
      --label-bg: var(--row-hover-solid);
      background: var(--row-hover);
    }
  }

  /* Au clavier, la ligne de l'élément focalisé (libellé ou barre) est repérable comme au survol. */
  .card-row:has(:global(:focus-visible)) {
    --label-bg: var(--row-hover-solid);
    background: var(--row-hover);
  }

  .blank-label {
    position: sticky;
    left: 0;
    z-index: 3;
    flex: none;
    width: var(--label-w);
    background: var(--surface);
    border-right: 1px solid var(--border);
  }

  .hint {
    position: sticky;
    align-self: center;
    margin: 0;
    padding-left: 12px;
    font-size: 12.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .filler {
    flex: 1 0 24px;
    display: flex;
  }

  /* ---------- États vides ---------- */

  .center {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    padding: 32px;
    color: var(--text-muted);
  }

  /* Même échelle que les autres états vides (liste des tableaux, page du tableau). */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 400px;
    text-align: center;
  }

  .empty h3 {
    margin-top: 20px;
    font-size: 15px;
    color: var(--text);
  }

  .empty p {
    margin: 6px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .empty-art rect {
    fill: var(--surface-3);
  }

  .empty-art .b2 {
    fill: var(--accent-soft);
    stroke: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .empty-art line {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    opacity: 0.6;
  }

  /* Mouvement réduit : pas de scale à l'appui. */
  @media (prefers-reduced-motion: reduce) {
    .seg button:active {
      transform: none;
    }
  }
</style>
