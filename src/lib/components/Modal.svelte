<!--
  Modale sur <dialog> natif : piège de focus, Échap et inertie du fond gérés par le navigateur.
  Entrée via @starting-style (app.css), sortie plus courte via [data-closing] puis close().
  Ouverte ou fermée au clavier (Entrée sur une carte, Échap…) : instantanée, sans animation.
  `onclose` est appelé à chaque fermeture, qu'elle vienne de l'utilisateur ou du code (open = false).
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { lastInputWasKeyboard } from '$lib/modality';

  let {
    open = $bindable(false),
    title,
    width = 560,
    onclose,
    children,
    footer,
    headerExtra
  }: {
    open?: boolean;
    title: string;
    width?: number;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
    headerExtra?: Snippet;
  } = $props();

  const uid = $props.id();
  let dialog: HTMLDialogElement;
  let closing = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Élément focalisé avant l'ouverture : il retrouve le focus à la fermeture si le navigateur ne l'a pas fait. */
  let returnFocus: HTMLElement | null = null;

  const EXIT_MS = 130;

  /** Posé directement sur l'élément, avant showModal() : le style de départ doit déjà le voir. */
  function setInstant(value: boolean) {
    dialog.toggleAttribute('data-instant', value);
  }

  function finishClose() {
    clearTimeout(timer);
    dialog.close();
    closing = false;
    const el = returnFocus;
    returnFocus = null;
    if (el?.isConnected && (!document.activeElement || document.activeElement === document.body)) {
      el.focus({ preventScroll: true });
    }
  }

  $effect(() => {
    if (!dialog) return;
    if (open) {
      clearTimeout(timer);
      if (closing) {
        // Rouverte pendant la sortie : on reprend où l'on en était.
        closing = false;
      } else if (!dialog.open) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setInstant(lastInputWasKeyboard());
        dialog.showModal();
      }
    } else if (dialog.open && !closing) {
      untrack(() => onclose?.());
      if (lastInputWasKeyboard()) {
        finishClose();
      } else {
        setInstant(false);
        closing = true;
        timer = setTimeout(finishClose, EXIT_MS);
      }
    }
  });

  $effect(() => () => clearTimeout(timer));

  function requestClose() {
    open = false;
  }

  function oncancel(e: Event) {
    // Échap : fermeture pilotée par `open` (même chemin que les autres fermetures, sans animation au clavier).
    e.preventDefault();
    requestClose();
  }

  /** Fermeture décidée par le navigateur lui-même (ex. Échap répété, non annulable) : on se resynchronise. */
  function onDialogClose() {
    if (dialog.open) return; // événement en retard d'une fermeture déjà suivie d'une réouverture
    clearTimeout(timer);
    closing = false;
    if (!open) return;
    open = false;
    onclose?.();
  }

  function onpointerdown(e: PointerEvent) {
    // Clic sur le fond (le <dialog> lui-même, hors contenu).
    if (e.target === dialog) requestClose();
  }
</script>

<dialog
  bind:this={dialog}
  class="modal"
  style:--modal-width="{width}px"
  data-closing={closing || undefined}
  aria-labelledby="{uid}-title"
  {oncancel}
  {onpointerdown}
  onclose={onDialogClose}
>
  {#if open || closing}
    <header class="modal-header">
      <h2 class="modal-title" id="{uid}-title">{title}</h2>
      <div class="header-actions">
        {@render headerExtra?.()}
        <button class="btn btn-ghost btn-sm btn-icon" type="button" aria-label="Fermer" onclick={requestClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </header>
    <div class="modal-body">
      {@render children()}
    </div>
    {#if footer}
      <footer class="modal-footer">
        {@render footer()}
      </footer>
    {/if}
  {/if}
</dialog>

<style>
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
</style>
