<!--
  Ajout rapide en pied de colonne : « + Ajouter une carte » → zone de saisie.
  Entrée crée la carte et laisse la saisie ouverte pour enchaîner ; Échap ferme.
-->
<script lang="ts">
  import Spinner from '$lib/components/Spinner.svelte';
  import { board } from '$lib/stores/board.svelte';
  import { autosize } from './autosize';

  let {
    stateId,
    stateName,
    oncreated
  }: {
    stateId: number;
    stateName: string;
    /** `viaPointer` : créée au clic (la carte peut alors apparaître en fondu ; jamais au clavier). */
    oncreated?: (cardId: number, viaPointer: boolean) => void;
  } = $props();

  let open = $state(false);
  let text = $state('');
  let pending = $state(0);
  let input = $state<HTMLTextAreaElement>();

  function start() {
    open = true;
  }

  function close() {
    open = false;
    text = '';
  }

  async function submit(viaPointer: boolean) {
    const title = text.trim().replace(/\s+/g, ' ');
    if (!title) return;
    text = ''; // saisie immédiatement libre pour la carte suivante
    input?.focus();
    pending++;
    const card = await board.createCard({ state_id: stateId, title });
    pending--;
    if (!card) {
      if (!text) text = title; // échec : on rend le texte à l'utilisateur
      return;
    }
    oncreated?.(card.id, viaPointer);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    if (!text.trim()) close();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="composer" {onfocusout}>
    <textarea
      bind:this={input}
      bind:value={text}
      class="textarea"
      rows="2"
      placeholder="Titre de la carte…"
      aria-label="Titre de la nouvelle carte ({stateName})"
      maxlength="500"
      {onkeydown}
      {@attach autosize(text, 160)}
      {@attach (n) => n.focus()}
    ></textarea>
    <div class="actions">
      <button class="btn btn-primary btn-sm" type="button" disabled={!text.trim()} onclick={() => submit(true)}>
        Ajouter
      </button>
      <button class="btn btn-ghost btn-sm" type="button" onclick={close}>Annuler</button>
      <span class="hint" aria-hidden="true">
        {#if pending}
          <Spinner size={12} />
        {:else}
          <span class="kbd">↵</span>
        {/if}
      </span>
    </div>
  </div>
{:else}
  <button class="btn btn-ghost btn-sm add" type="button" onclick={start}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    Ajouter une carte
  </button>
{/if}

<style>
  .add {
    width: 100%;
    justify-content: flex-start;
    height: 30px;
    color: var(--text-muted);
  }

  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .composer .textarea {
    min-height: 56px;
    resize: none;
    font-size: 13.5px;
  }

  /* L'ombre de repos ne doit pas écraser l'anneau de focus global (.textarea:focus). */
  .composer .textarea:not(:focus) {
    box-shadow: var(--shadow-sm);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .hint {
    display: inline-flex;
    align-items: center;
    margin-left: auto;
    padding-right: 2px;
    color: var(--text-subtle);
  }
</style>
