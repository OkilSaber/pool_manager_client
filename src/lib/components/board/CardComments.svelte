<!--
  Commentaires d'une carte (fiche d'une carte existante). Liste chronologique chargée à l'ouverture,
  zone de saisie qui grandit en bas (envoi : bouton ou Cmd/Ctrl+Entrée).
  Ses propres commentaires : modifier en place (Échap annule, Cmd/Ctrl+Entrée enregistre) et supprimer
  (confirmation en place : le premier clic arme « Confirmer » 3 s). Propriétaire du projet ou du pool :
  peut aussi supprimer ceux des autres. Corps en texte brut, retours à la ligne conservés.
  Échap dans une zone modifiée annule / quitte le champ sans fermer la modale.
-->
<script module lang="ts">
  /** Brouillons par carte : fermer la fiche ou passer à une autre carte ne perd pas un commentaire en cours. */
  const drafts = new Map<number, string>();
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import { board } from '$lib/stores/board.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Card } from '$lib/types/Card';
  import type { Comment } from '$lib/types/Comment';
  import { fmtDateTime, fmtRelative } from '$lib/format';
  import { autosize } from './autosize';

  let { card }: { card: Card } = $props();

  const uid = $props.id();
  /** Longueur maximale d'un commentaire (comme le serveur, espaces de début et de fin retirés). */
  const MAX_LENGTH = 10_000;
  const shortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘↵' : 'Ctrl+↵';

  let comments = $state<Comment[]>([]);
  let loading = $state(false);
  /** Chargement terminé au moins une fois pour la carte affichée (sinon : spinner plutôt que « aucun commentaire »). */
  let loaded = $state(false);
  let draft = $state('');
  let sending = $state(false);
  /** Commentaires ajoutés pendant la session : seuls eux apparaissent en fondu (pas toute la liste au chargement). */
  let fresh = $state<Set<number>>(new Set());

  let editingId = $state<number | null>(null);
  let editText = $state('');
  let saving = $state(false);

  let confirmId = $state<number | null>(null);
  let removing = $state<number | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  /** Horloge des dates relatives, rafraîchie chaque minute. */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(id);
  });

  const me = $derived(session.user?.id ?? null);
  const project = $derived(board.projectOf(card.project_id));
  /** Propriétaire du projet ou du pool : modération (suppression des commentaires des autres). */
  const moderator = $derived(me != null && (project?.owner_id === me || board.pool?.owner_id === me));

  // ---------- Chargement (à l'ouverture, et quand la fiche passe à une autre carte) ----------

  let loadToken = 0;
  let shownId: number | null = null;

  $effect(() => {
    const id = card.id;
    if (id === shownId) return;
    untrack(() => {
      if (shownId != null) drafts.set(shownId, draft);
      shownId = id;
      draft = drafts.get(id) ?? '';
      comments = [];
      fresh = new Set();
      loaded = false;
      editingId = null;
      confirmId = null;
      clearTimeout(confirmTimer);
      void load(id);
    });
  });

  // Démontage (fiche fermée) : on garde le brouillon pour la prochaine ouverture.
  $effect(() => () => {
    if (shownId != null) drafts.set(shownId, draft);
    clearTimeout(confirmTimer);
  });

  async function load(id: number) {
    const token = ++loadToken;
    loading = true;
    try {
      const list = await api.listComments(id);
      if (token !== loadToken) return;
      comments = list;
      loaded = true;
      board.setCommentCount(id, list.length);
    } catch (e) {
      if (token === loadToken) toast.error(e);
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  // ---------- Envoi ----------

  const canSend = $derived(draft.trim().length > 0 && !sending);

  async function send() {
    const body = draft.trim();
    const id = card.id;
    if (!body || sending) return;
    sending = true;
    try {
      const created = await api.createComment(id, body);
      if (id !== card.id) return; // fiche passée à une autre carte entre-temps
      fresh = new Set([...fresh, created.id]);
      comments = [...comments, created];
      board.setCommentCount(id, comments.length);
      // Texte tapé pendant l'envoi : on le garde (seul ce qui a été envoyé disparaît).
      draft = draft.trim() === body ? '' : draft;
      drafts.delete(id);
    } catch (e) {
      toast.error(e);
    } finally {
      sending = false;
    }
  }

  const isSubmit = (e: KeyboardEvent) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing;

  function ondraftkey(e: KeyboardEvent) {
    if (isSubmit(e)) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape' && draft.trim()) {
      // Brouillon en cours : Échap quitte le champ (le texte reste) au lieu de fermer la fiche.
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).blur();
    }
  }

  // ---------- Modification ----------

  function startEdit(c: Comment) {
    editingId = c.id;
    editText = c.body;
    confirmId = null;
  }

  function cancelEdit() {
    editingId = null;
    editText = '';
  }

  async function saveEdit(c: Comment) {
    const body = editText.trim();
    if (saving) return;
    if (!body) {
      toast.info('Un commentaire ne peut pas être vide : supprimez-le plutôt.');
      return;
    }
    if (body === c.body) return cancelEdit();
    saving = true;
    try {
      const updated = await api.updateComment(c.id, body);
      comments = comments.map((x) => (x.id === updated.id ? updated : x));
      if (editingId === c.id) cancelEdit();
    } catch (e) {
      toast.error(e);
    } finally {
      saving = false;
    }
  }

  function oneditkey(e: KeyboardEvent, c: Comment) {
    if (isSubmit(e)) {
      e.preventDefault();
      void saveEdit(c);
    } else if (e.key === 'Escape') {
      // Annule l'édition, sans fermer la fiche.
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
      focusActions(c.id);
    }
  }

  /** Champ d'édition : focus, curseur en fin de texte. */
  function focusEnd(node: HTMLTextAreaElement) {
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }

  /** Après l'édition, le focus revient sur le commentaire (le champ disparaît) plutôt que sur <body>. */
  function focusActions(id: number) {
    queueMicrotask(() => document.getElementById(`${uid}-c${id}`)?.focus({ preventScroll: true }));
  }

  // ---------- Suppression (confirmation en place) ----------

  async function remove(c: Comment) {
    if (confirmId !== c.id) {
      confirmId = c.id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmId = null), 3000);
      return;
    }
    clearTimeout(confirmTimer);
    confirmId = null;
    removing = c.id;
    const id = card.id;
    try {
      await api.deleteComment(c.id);
      comments = comments.filter((x) => x.id !== c.id);
      if (id === card.id) board.setCommentCount(id, comments.length);
    } catch (e) {
      toast.error(e);
    } finally {
      removing = null;
    }
  }
</script>

<section class="comments" aria-labelledby="{uid}-title">
  <div class="head">
    <h3 class="label" id="{uid}-title">
      Commentaires
      {#if comments.length}<span class="count num">{comments.length}</span>{/if}
    </h3>
    {#if loading && loaded}<Spinner size={12} label="Actualisation des commentaires" />{/if}
  </div>

  {#if !loaded && loading}
    <div class="loading"><Spinner size={14} label="Chargement des commentaires" /></div>
  {:else if comments.length}
    <ol class="list">
      {#each comments as c (c.id)}
        {@const mine = c.author_id === me}
        {@const editing = editingId === c.id}
        <li class="item" class:fresh={fresh.has(c.id)} id="{uid}-c{c.id}" tabindex="-1">
          <Avatar id={c.author_id} name={c.author_name} size={24} />
          <div class="content">
            <div class="meta">
              <span class="author">{c.author_name}</span>
              <time class="when" datetime={c.created_at} title={fmtDateTime(c.created_at)}>{fmtRelative(c.created_at, now)}</time>
              {#if c.edited_at}
                <span class="edited" title="Modifié le {fmtDateTime(c.edited_at)}">(modifié)</span>
              {/if}
              {#if !editing && (mine || moderator)}
                <span class="actions" class:armed={confirmId === c.id || removing === c.id}>
                  {#if mine}
                    <button class="btn btn-ghost btn-sm" type="button" onclick={() => startEdit(c)}>Modifier</button>
                  {/if}
                  <button
                    class="btn btn-sm"
                    class:btn-ghost={confirmId !== c.id}
                    class:btn-danger={confirmId === c.id}
                    type="button"
                    disabled={removing === c.id}
                    aria-label={confirmId === c.id
                      ? `Confirmer la suppression du commentaire de ${c.author_name}`
                      : `Supprimer le commentaire de ${c.author_name}`}
                    onclick={() => remove(c)}
                  >
                    {#if removing === c.id}<Spinner size={12} />{/if}
                    {confirmId === c.id ? 'Confirmer' : 'Supprimer'}
                  </button>
                </span>
              {/if}
            </div>
            {#if editing}
              <div class="edit">
                <textarea
                  class="textarea compose-input"
                  rows="2"
                  maxlength={MAX_LENGTH}
                  aria-label="Modifier le commentaire"
                  bind:value={editText}
                  onkeydown={(e) => oneditkey(e, c)}
                  {@attach autosize(editText, 320)}
                  {@attach focusEnd}
                ></textarea>
                <div class="edit-actions">
                  <span class="hint"><span class="kbd" aria-hidden="true">{shortcut}</span> pour enregistrer · Échap pour annuler</span>
                  <button
                    class="btn btn-sm"
                    type="button"
                    onclick={() => {
                      cancelEdit();
                      focusActions(c.id);
                    }}
                  >
                    Annuler
                  </button>
                  <button class="btn btn-sm btn-primary" type="button" aria-busy={saving} onclick={() => saveEdit(c)}>
                    <BusyLabel busy={saving}>Enregistrer</BusyLabel>
                  </button>
                </div>
              </div>
            {:else}
              <p class="body">{c.body}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {:else if loaded}
    <p class="empty">Aucun commentaire pour l’instant.</p>
  {/if}

  <div class="compose">
    <textarea
      class="textarea compose-input"
      rows="1"
      maxlength={MAX_LENGTH}
      placeholder="Écrire un commentaire…"
      aria-label="Écrire un commentaire"
      bind:value={draft}
      onkeydown={ondraftkey}
      {@attach autosize(draft, 240)}
    ></textarea>
    <div class="compose-actions" class:show={draft.length > 0 || sending}>
      <span class="hint"><span class="kbd" aria-hidden="true">{shortcut}</span> pour envoyer</span>
      <button
        class="btn btn-sm btn-primary"
        type="button"
        disabled={!canSend && !sending}
        aria-busy={sending}
        onclick={send}
      >
        <BusyLabel busy={sending}>Commenter</BusyLabel>
      </button>
    </div>
  </div>
</section>

<style>
  .comments {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 20px;
    color: var(--text-muted);
  }

  h3.label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
  }

  .count {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11px;
    line-height: 16px;
    color: var(--text-muted);
  }

  .loading {
    display: flex;
    justify-content: center;
    padding: 12px 0;
    color: var(--text-subtle);
  }

  .empty {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-subtle);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
    border-radius: var(--radius-sm);
  }

  .item:focus {
    outline: none;
  }

  .item:focus-visible {
    box-shadow: var(--focus);
  }

  /* Commentaire tout juste ajouté : léger fondu montant (le reste de la liste ne bouge pas). */
  .item.fresh {
    transition:
      opacity 200ms var(--ease-out),
      transform 200ms var(--ease-out);
  }

  @starting-style {
    .item.fresh {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .author {
    overflow: hidden;
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .when,
  .edited {
    flex: none;
    white-space: nowrap;
  }

  .edited {
    color: var(--text-subtle);
  }

  /* Actions discrètes : révélées au survol ou au focus (toujours visibles sans souris). */
  .actions {
    display: inline-flex;
    gap: 2px;
    margin-left: auto;
    transition: opacity var(--dur-hover) ease;
  }

  .actions .btn {
    height: 22px;
    padding: 0 6px;
    font-size: 12px;
  }

  @media (hover: hover) and (pointer: fine) {
    .actions {
      opacity: 0;
    }
    .item:hover .actions,
    .actions:focus-within,
    .actions.armed {
      opacity: 1;
    }
  }

  /* Texte brut : retours à la ligne conservés, longs mots coupés ; sélectionnable (copier un lien). */
  .body {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-user-select: text;
  }

  .edit {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 2px;
  }

  .edit-actions,
  .compose-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .hint {
    margin-right: auto;
    font-size: 11.5px;
    color: var(--text-subtle);
  }

  .compose {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .compose-input {
    min-height: 0;
    resize: none;
  }

  /* Bouton et raccourci n'apparaissent qu'une fois la saisie commencée : la zone reste légère au repos. */
  .compose-actions {
    display: none;
  }

  .compose-actions.show {
    display: flex;
  }

  @media (prefers-reduced-motion: reduce) {
    @starting-style {
      .item.fresh {
        transform: none;
      }
    }
  }
</style>
