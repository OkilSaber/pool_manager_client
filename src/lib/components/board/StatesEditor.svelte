<!--
  Éditeur des colonnes (états) du tableau ouvert : pool, ou projet autonome.
  Un projet rattaché à un pool utilise les colonnes du pool : liste en lecture seule et lien vers le pool.

  Tout s'applique tout de suite (store optimiste), sans bouton « Enregistrer » :
  - réordonner : poignée glissée (transform seulement, les voisines s'écartent), ou ↑/↓ sur la poignée,
    Alt + ↑/↓ partout dans la ligne ; la nouvelle position est calculée par positionBetween ;
  - couleur : pastille → palette ;
  - nom : édité en place, enregistré sur Entrée / perte du focus, Échap annule ;
  - suppression : seulement si la colonne est vide (confirmation en place) ; un 409 du serveur
    (cartes d'un projet archivé, par exemple) est affiché en toast par le store.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import Modal from '$lib/components/Modal.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { lastInputWasKeyboard } from '$lib/modality';
  import { DUR, easeOut, reducedMotion } from '$lib/motion';
  import { board, positionBetween } from '$lib/stores/board.svelte';
  import { tooltip } from '$lib/tooltip';
  import type { State } from '$lib/types/State';
  import ColorPicker from './ColorPicker.svelte';
  import { PALETTE } from './palette';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const uid = $props.id();
  const hintId = `${uid}-reorder-hint`;

  const states = $derived(board.states);
  const isPool = $derived(board.kind === 'pool');
  /** Projet rattaché à un pool : ses colonnes sont celles du pool, gérées depuis le pool. */
  const managed = $derived(board.kind === 'project' && board.pool != null);
  const canReorder = $derived(!managed && states.length > 1);

  /** Cartes par colonne dans la vue courante (sans le filtre de projets : une carte masquée compte quand même). */
  const counts = $derived.by(() => {
    const m = new Map<number, number>();
    for (const c of board.cards) m.set(c.state_id, (m.get(c.state_id) ?? 0) + 1);
    return m;
  });

  const plural = (n: number) => (n > 1 ? 's' : '');

  let listEl = $state<HTMLOListElement>();
  let announcement = $state('');

  function announce(text: string) {
    // Vidé puis reposé : le même message répété est relu.
    announcement = '';
    tick().then(() => (announcement = text));
  }

  function rows(): HTMLLIElement[] {
    return listEl ? Array.from(listEl.querySelectorAll<HTMLLIElement>(':scope > li')) : [];
  }

  // ---------- Réordonner ----------

  /** Mis à vrai le temps d'un réordonnancement dont la ligne est déjà visuellement à sa place (fin de glisser). */
  let skipFlip = false;

  function reorder(node: Element, rects: { from: DOMRect; to: DOMRect }) {
    // Au clavier, chaque appui doit être instantané ; au glisser, la ligne est déjà posée.
    if (skipFlip || lastInputWasKeyboard() || reducedMotion()) return { duration: 0 };
    return flip(node, rects, { duration: DUR.flip, easing: easeOut });
  }

  /** Déplace la colonne à l'index `to` de la liste finale. */
  function moveTo(id: number, to: number) {
    const from = states.findIndex((s) => s.id === id);
    if (from < 0 || to === from || to < 0 || to >= states.length) return;
    const others = states.filter((s) => s.id !== id);
    const position = positionBetween(others[to - 1]?.position, others[to]?.position);
    board.updateState(id, { position });
    announce(`${states[from].name} : position ${to + 1} sur ${states.length}`);
  }

  async function moveBy(s: State, delta: number) {
    if (!canReorder) return;
    const i = states.findIndex((x) => x.id === s.id);
    const to = i + delta;
    if (to < 0 || to >= states.length) return;
    // Le nœud est déplacé dans le DOM : il perd le focus, qu'on lui rend.
    const active = document.activeElement as HTMLElement | null;
    moveTo(s.id, to);
    await tick();
    if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    active?.scrollIntoView({ block: 'nearest' });
  }

  function onrowkeydown(e: KeyboardEvent, s: State) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    moveBy(s, e.key === 'ArrowUp' ? -1 : 1);
  }

  function onhandlekeydown(e: KeyboardEvent, s: State) {
    if (e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    moveBy(s, e.key === 'ArrowUp' ? -1 : 1);
  }

  type Drag = {
    id: number;
    pointerId: number;
    handle: HTMLElement;
    els: HTMLLIElement[];
    from: number;
    target: number;
    startY: number;
    tops: number[];
    heights: number[];
    step: number;
    minDy: number;
    maxDy: number;
  };

  let drag: Drag | null = null;
  let settling = false;

  function onhandledown(e: PointerEvent, s: State) {
    if (e.button !== 0 || !canReorder || drag || settling) return;
    const els = rows();
    const from = els.findIndex((el) => el.dataset.id === String(s.id));
    if (from < 0) return;
    e.preventDefault(); // pas de sélection de texte pendant le glisser
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const rects = els.map((el) => el.getBoundingClientRect());
    const tops = rects.map((r) => r.top);
    const heights = rects.map((r) => r.height);
    const last = els.length - 1;
    const gap = els.length > 1 ? tops[1] - (tops[0] + heights[0]) : 0;
    drag = {
      id: s.id,
      pointerId: e.pointerId,
      handle,
      els,
      from,
      target: from,
      startY: e.clientY,
      tops,
      heights,
      step: heights[from] + gap,
      minDy: tops[0] - tops[from],
      maxDy: tops[last] + heights[last] - (tops[from] + heights[from])
    };
    listEl?.classList.add('sorting');
    els[from].classList.add('lifted');
    window.addEventListener('keydown', ondragkey, true);
  }

  /** Décalage de la ligne glissée quand elle occupe la place `target`. */
  function slotOffset(d: Drag, target: number): number {
    if (target > d.from) return d.tops[target] + d.heights[target] - (d.tops[d.from] + d.heights[d.from]);
    if (target < d.from) return d.tops[target] - d.tops[d.from];
    return 0;
  }

  function layoutOthers(d: Drag) {
    d.els.forEach((el, i) => {
      if (i === d.from) return;
      let shift = 0;
      if (d.from < i && i <= d.target) shift = -d.step;
      else if (d.target <= i && i < d.from) shift = d.step;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function onhandlemove(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = Math.min(d.maxDy, Math.max(d.minDy, e.clientY - d.startY));
    d.els[d.from].style.transform = `translateY(${dy}px)`;
    const center = d.tops[d.from] + d.heights[d.from] / 2 + dy;
    let target = d.from;
    for (let i = d.from + 1; i < d.els.length; i++) if (center > d.tops[i] + d.heights[i] / 2) target = i;
    for (let i = d.from - 1; i >= 0; i--) if (center < d.tops[i] + d.heights[i] / 2) target = i;
    if (target !== d.target) {
      d.target = target;
      layoutOthers(d);
    }
  }

  function ondragkey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !drag) return;
    // Échap annule le glisser sans fermer la modale.
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  }

  function onhandleup(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) finish(true);
  }

  function onhandlecancel(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) finish(false);
  }

  function finish(commit: boolean) {
    const d = drag;
    if (!d) return;
    drag = null;
    window.removeEventListener('keydown', ondragkey, true);
    if (d.handle.hasPointerCapture(d.pointerId)) d.handle.releasePointerCapture(d.pointerId);
    if (!commit) d.target = d.from;
    layoutOthers(d);

    const lifted = d.els[d.from];
    const offset = slotOffset(d, d.target);
    settling = true;
    // La ligne se pose dans sa place (ou revient), puis l'ordre réel remplace les transforms sans saut.
    lifted.style.transition = `transform ${DUR.exit + 20}ms var(--ease-out)`;
    lifted.style.transform = offset ? `translateY(${offset}px)` : '';
    setTimeout(() => settle(d), reducedMotion() ? 0 : DUR.exit + 20);
  }

  async function settle(d: Drag) {
    const moved = d.target !== d.from;
    for (const el of d.els) {
      el.style.transition = 'none';
      el.style.transform = '';
    }
    d.els[d.from].classList.remove('lifted');
    listEl?.classList.remove('sorting');
    skipFlip = true;
    if (moved) moveTo(d.id, d.target);
    await tick();
    skipFlip = false;
    for (const el of d.els) el.style.transition = '';
    settling = false;
  }

  $effect(() => () => window.removeEventListener('keydown', ondragkey, true));

  // ---------- Nom ----------

  function commitName(s: State, input: HTMLInputElement) {
    const value = input.value.trim();
    if (!value || value === s.name) {
      input.value = s.name;
      return;
    }
    board.updateState(s.id, { name: value });
  }

  function onnamekeydown(e: KeyboardEvent, s: State) {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      commitName(s, input);
      input.select();
    } else if (e.key === 'Escape' && input.value !== s.name) {
      // Premier Échap : annule la saisie ; le suivant ferme la modale.
      e.preventDefault();
      input.value = s.name;
      input.select();
    }
  }

  // ---------- Suppression ----------

  let armed = $state<number | null>(null);
  let deleting = $state<number | null>(null);
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  function disarm() {
    clearTimeout(armTimer);
    armed = null;
  }

  async function remove(s: State) {
    if ((counts.get(s.id) ?? 0) > 0 || deleting != null) return;
    if (armed !== s.id) {
      armed = s.id;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => (armed = null), 3000);
      return;
    }
    disarm();
    const index = states.findIndex((x) => x.id === s.id);
    deleting = s.id;
    const ok = await board.deleteState(s.id);
    deleting = null;
    if (!ok) return;
    announce(`Colonne ${s.name} supprimée`);
    await tick();
    // Le focus passe à la ligne qui prend sa place (ou la précédente), sinon au champ d'ajout.
    const names = listEl?.querySelectorAll<HTMLInputElement>('.name-input') ?? [];
    const next = names[Math.min(index, names.length - 1)] ?? addInput;
    next?.focus();
  }

  // ---------- Ajout ----------

  let newName = $state('');
  let pickedColor = $state<string | null>(null);
  let adding = $state(false);
  let addInput = $state<HTMLInputElement>();

  /** Première couleur de la palette pas encore utilisée par une colonne. */
  const suggestedColor = $derived.by(() => {
    const used = new Set(states.map((s) => s.color.toLowerCase()));
    return PALETTE.find((c) => !used.has(c.value))?.value ?? PALETTE[states.length % PALETTE.length].value;
  });
  const newColor = $derived(pickedColor ?? suggestedColor);

  async function add(e?: SubmitEvent) {
    e?.preventDefault();
    const value = newName.trim();
    if (!value || adding) return;
    adding = true;
    newName = '';
    const created = await board.createState(value, newColor);
    adding = false;
    if (created) {
      pickedColor = null;
      announce(`Colonne ${value} ajoutée`);
    } else if (!newName) {
      newName = value;
    }
    await tick();
    addInput?.focus();
    addInput?.scrollIntoView({ block: 'nearest' });
  }

  function onaddkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && newName) {
      e.preventDefault();
      newName = '';
    }
  }

  function onclose() {
    if (drag) finish(false);
    disarm();
    newName = '';
    pickedColor = null;
  }

  function enter(_node: Element) {
    const still = reducedMotion();
    return {
      duration: DUR.pop,
      easing: easeOut,
      css: (t: number) => `opacity: ${t};${still ? '' : ` transform: translateY(${(1 - t) * -4}px);`}`
    };
  }
</script>

<Modal bind:open title={isPool ? 'Colonnes du pool' : 'Colonnes du projet'} width={520} {onclose}>
  {#if managed && board.pool}
    <p class="intro">
      Ce projet utilise les colonnes du pool <strong>{board.pool.name}</strong> ; elles se gèrent depuis le pool.
      <a class="pool-link" href="/pools/{board.pool.id}" onclick={() => (open = false)}>Gérer les colonnes du pool</a>
    </p>
  {:else}
    <p class="intro">
      {isPool ? 'Ces colonnes s’appliquent à tous les projets du pool.' : 'Ces colonnes sont propres à ce projet.'}
      Les modifications sont enregistrées immédiatement.
    </p>
  {/if}

  <span class="sr-only" id={hintId}>Flèches haut et bas pour déplacer la colonne.</span>
  <p class="sr-only" aria-live="polite">{announcement}</p>

  {#if states.length}
    <ol class="list" bind:this={listEl} aria-label="Colonnes, dans l’ordre d’affichage">
      {#each states as s, i (s.id)}
        {@const count = counts.get(s.id) ?? 0}
        {@const locked = count > 0}
        <!-- Alt + ↑/↓ depuis n'importe quel contrôle de la ligne (délégation, pas une interaction propre au <li>). -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li class="row" data-id={s.id} animate:reorder in:enter onkeydown={(e) => !managed && onrowkeydown(e, s)}>
          {#if canReorder}
            <button
              class="handle"
              type="button"
              aria-label="Déplacer {s.name} (position {i + 1} sur {states.length})"
              aria-describedby={hintId}
              onpointerdown={(e) => onhandledown(e, s)}
              onpointermove={onhandlemove}
              onpointerup={onhandleup}
              onpointercancel={onhandlecancel}
              onkeydown={(e) => onhandlekeydown(e, s)}
              {@attach tooltip('Glisser pour réordonner · Alt + ↑/↓')}
            >
              <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                <circle cx="3" cy="3" r="1.2" fill="currentColor" />
                <circle cx="7" cy="3" r="1.2" fill="currentColor" />
                <circle cx="3" cy="7" r="1.2" fill="currentColor" />
                <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                <circle cx="3" cy="11" r="1.2" fill="currentColor" />
                <circle cx="7" cy="11" r="1.2" fill="currentColor" />
              </svg>
            </button>
          {:else}
            <span class="handle-spacer" aria-hidden="true"></span>
          {/if}

          <ColorPicker
            value={s.color}
            label="Couleur de la colonne {s.name}"
            disabled={managed}
            onpick={(color) => board.updateState(s.id, { color })}
          />

          {#if managed}
            <span class="name-static" title={s.name}>{s.name}</span>
          {:else}
            <input
              class="name-input"
              value={s.name}
              aria-label="Nom de la colonne {i + 1}"
              maxlength="80"
              autocomplete="off"
              spellcheck="false"
              onblur={(e) => commitName(s, e.currentTarget)}
              onkeydown={(e) => onnamekeydown(e, s)}
            />
          {/if}

          <span class="count num" class:empty={!count}>{count ? `${count} carte${plural(count)}` : 'Vide'}</span>

          {#if !managed}
            {#if armed === s.id}
              <button class="btn btn-sm btn-danger confirm" type="button" aria-label="Confirmer la suppression de {s.name}" onclick={() => remove(s)}>
                Supprimer ?
              </button>
            {:else}
              <button
                class="btn btn-ghost btn-sm btn-icon delete"
                type="button"
                aria-label="Supprimer la colonne {s.name}"
                aria-disabled={locked || deleting === s.id}
                aria-busy={deleting === s.id}
                aria-describedby={locked ? `${uid}-locked-${s.id}` : undefined}
                onclick={() => remove(s)}
                {@attach tooltip(locked ? `Déplacez ou supprimez d’abord ${count > 1 ? `ses ${count} cartes` : 'sa carte'}` : 'Supprimer')}
              >
                {#if deleting === s.id}
                  <Spinner size={12} />
                {:else}
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" />
                  </svg>
                {/if}
              </button>
              {#if locked}
                <span class="sr-only" id="{uid}-locked-{s.id}">
                  Impossible : déplacez ou supprimez d’abord {count > 1 ? `ses ${count} cartes` : 'sa carte'}.
                </span>
              {/if}
            {/if}
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty-list">Aucune colonne pour l’instant. Ajoutez-en une ci-dessous pour commencer à ranger des cartes.</p>
  {/if}

  {#if !managed}
    <form class="add" onsubmit={add}>
      <span class="handle-spacer" aria-hidden="true"></span>
      <ColorPicker value={newColor} label="Couleur de la nouvelle colonne" onpick={(c) => (pickedColor = c)} />
      <label class="sr-only" for="{uid}-new">Nouvelle colonne</label>
      <input
        id="{uid}-new"
        bind:this={addInput}
        bind:value={newName}
        class="input add-input"
        placeholder="Ajouter une colonne"
        maxlength="80"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onaddkeydown}
        {@attach (n) => {
          if (!states.length) n.focus();
        }}
      />
      <button class="btn btn-sm btn-primary" type="submit" disabled={!newName.trim()} aria-busy={adding}>
        {#if adding}<Spinner size={12} />{/if}
        Ajouter
      </button>
    </form>
  {/if}
</Modal>

<style>
  .intro {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .intro strong {
    font-weight: 600;
    color: var(--text);
  }

  .pool-link {
    display: inline-block;
    margin-top: 2px;
    color: var(--accent);
    font-weight: 500;
    text-decoration: none;
    border-radius: 4px;
  }

  .pool-link:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  @media (hover: hover) and (pointer: fine) {
    .pool-link:hover {
      text-decoration: underline;
    }
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 -8px;
    padding: 0;
    list-style: none;
  }

  .row,
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 6px 0 4px;
    border-radius: var(--radius);
    background: var(--surface);
  }

  .row {
    position: relative;
  }

  @media (hover: hover) and (pointer: fine) {
    .row:hover {
      background: var(--surface-2);
    }
  }

  .row:focus-within {
    background: var(--surface-2);
  }

  /* Pendant un glisser : les voisines s'écartent en douceur, la ligne tenue suit le pointeur sans délai. */
  .list:global(.sorting) > .row {
    transition: transform 200ms var(--ease-out);
  }

  .list:global(.sorting) > .row:global(.lifted) {
    z-index: 1;
    background: var(--surface);
    box-shadow: var(--shadow-md);
    transition: none;
  }

  .list:global(.sorting) {
    cursor: grabbing;
  }

  .handle,
  .handle-spacer {
    flex: none;
    width: 18px;
    height: 26px;
  }

  .handle {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-subtle);
    cursor: grab;
    touch-action: none;
    transition: color var(--dur-hover) ease;
  }

  .handle:focus-visible {
    outline: none;
    box-shadow: var(--focus);
    color: var(--text);
  }

  @media (hover: hover) and (pointer: fine) {
    .handle:hover {
      color: var(--text);
    }
  }

  .list:global(.sorting) .handle {
    cursor: grabbing;
  }

  .name-input,
  .name-static {
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--text);
  }

  .name-input {
    background: transparent;
    cursor: text;
    transition:
      border-color var(--dur-hover) ease,
      background-color var(--dur-hover) ease,
      box-shadow var(--dur-hover) ease;
  }

  .name-static {
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  @media (hover: hover) and (pointer: fine) {
    .name-input:hover {
      border-color: var(--border);
    }
  }

  .name-input:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface);
    box-shadow: var(--focus);
  }

  .count {
    flex: none;
    min-width: 56px;
    font-size: 12px;
    text-align: right;
    color: var(--text-muted);
  }

  .count.empty {
    color: var(--text-subtle);
  }

  .delete,
  .confirm {
    flex: none;
  }

  .delete[aria-disabled='true'] {
    color: var(--text-subtle);
    opacity: 0.6;
    cursor: default;
  }

  .delete[aria-disabled='true']:active {
    transform: none;
  }

  @media (hover: hover) and (pointer: fine) {
    .delete:not([aria-disabled='true']):hover {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .delete[aria-disabled='true']:hover {
      background: transparent;
      color: var(--text-subtle);
    }
  }

  .confirm {
    font-size: 12.5px;
    background: var(--danger-soft);
    border-color: transparent;
    box-shadow: none;
  }

  .empty-list {
    margin: 4px 0 8px;
    padding: 14px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
    color: var(--text-muted);
  }

  .add {
    margin: 8px -8px 0;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
  }

  .add-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 30px;
    font-size: 13.5px;
  }

  @media (prefers-reduced-motion: reduce) {
    .list:global(.sorting) > .row {
      transition: none;
    }
  }
</style>
