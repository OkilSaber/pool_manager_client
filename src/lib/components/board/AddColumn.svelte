<!-- Colonne fantôme en fin de Kanban : Entrée crée la colonne et garde la saisie prête pour la suivante. -->
<script lang="ts">
  import { tick } from 'svelte';
  import { board } from '$lib/stores/board.svelte';
  import { PALETTE } from './palette';

  const uid = $props.id();
  let open = $state(false);
  let name = $state('');
  let input = $state<HTMLInputElement>();

  /** Première couleur de la palette pas encore utilisée par une colonne. */
  function nextColor(): string {
    const used = new Set(board.states.map((s) => s.color.toLowerCase()));
    return PALETTE.find((c) => !used.has(c.value))?.value ?? PALETTE[board.states.length % PALETTE.length].value;
  }

  async function submit() {
    const value = name.trim();
    if (!value) return;
    name = '';
    const created = await board.createState(value, nextColor());
    if (!created && !name) name = value;
    await tick();
    // La colonne fantôme vient d'être poussée vers la droite : on la garde visible pour enchaîner.
    input?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    input?.focus();
  }

  function close() {
    open = false;
    name = '';
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    if (!name.trim()) close();
  }
</script>

<div class="ghost-col">
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="form" {onfocusout}>
      <label class="label" for="{uid}-name">Nouvelle colonne</label>
      <input
        id="{uid}-name"
        bind:this={input}
        bind:value={name}
        class="input"
        placeholder="Nom de la colonne"
        maxlength="80"
        autocomplete="off"
        {onkeydown}
        {@attach (n) => n.focus()}
      />
      <div class="actions">
        <button class="btn btn-primary btn-sm" type="button" disabled={!name.trim()} onclick={submit}>Ajouter</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick={close}>Fermer</button>
      </div>
    </div>
  {:else}
    <button class="add" type="button" onclick={() => (open = true)}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      Ajouter une colonne
    </button>
    {#if board.states.length === 0}
      <p class="empty">{board.kind === 'pool' ? 'Ce pool' : 'Ce projet'} n’a pas encore de colonne. Créez-en une pour commencer à y ranger des cartes.</p>
    {/if}
  {/if}
</div>

<style>
  .ghost-col {
    flex: none;
    width: 280px;
  }

  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    /* Même hauteur que l'en-tête des colonnes : le libellé s'aligne sur leurs noms. */
    height: 44px;
    padding: 0 12px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-hover) ease,
      color var(--dur-hover) ease;
  }

  .add:active {
    transform: scale(0.98);
  }

  .add:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  @media (hover: hover) and (pointer: fine) {
    .add:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .empty {
    margin: 10px 2px 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .add:active {
      transform: none;
    }
  }
</style>
