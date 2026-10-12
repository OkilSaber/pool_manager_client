<!--
  Membres du pool. Propriétaire : inviter par email, retirer un membre (confirmation en place).
  Membre : quitter le pool (confirmation en place).
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import Avatar from '$lib/components/Avatar.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { board } from '$lib/stores/board.svelte';
  import { poolsCache } from '$lib/stores/pools-cache';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const uid = $props.id();

  let email = $state('');
  let inviting = $state(false);
  let confirmId = $state<number | null>(null);
  let removing = $state<number | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const me = $derived(session.user?.id ?? null);
  const members = $derived(
    [...board.members].sort((a, b) => (a.role === b.role ? a.display_name.localeCompare(b.display_name, 'fr') : a.role === 'owner' ? -1 : 1))
  );
  const validEmail = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!validEmail || inviting) return;
    inviting = true;
    const ok = await board.addMember(value);
    inviting = false;
    if (ok) {
      const added = board.members.find((m) => m.email.toLowerCase() === value);
      email = '';
      toast.success(`${added?.display_name ?? value} a rejoint le pool`);
    }
  }

  function arm(userId: number) {
    confirmId = userId;
    clearTimeout(timer);
    timer = setTimeout(() => (confirmId = null), 3000);
  }

  async function remove(userId: number) {
    if (confirmId !== userId) return arm(userId);
    clearTimeout(timer);
    confirmId = null;
    removing = userId;
    const leaving = userId === me;
    const ok = await board.removeMember(userId);
    removing = null;
    // Les parts restantes des cartes où ce membre était assigné sont ramenées à 100 % par le store, comme sur le serveur.
    if (ok && leaving) {
      const poolId = board.pool?.id;
      poolsCache.update((list) => list.filter((p) => p.id !== poolId));
      open = false;
      toast.info('Vous avez quitté le pool');
      goto('/pools');
    }
  }

  function onclose() {
    clearTimeout(timer);
    confirmId = null;
  }
</script>

<Modal bind:open title="Membres du pool" width={480} {onclose}>
  {#if board.isOwner}
    <form class="invite" onsubmit={invite}>
      <label class="label" for="{uid}-email">Inviter par email</label>
      <div class="invite-row">
        <input
          id="{uid}-email"
          class="input"
          type="email"
          placeholder="prenom.nom@exemple.fr"
          autocomplete="off"
          spellcheck="false"
          bind:value={email}
          readonly={inviting}
          aria-busy={inviting}
        />
        <button class="btn btn-primary" type="submit" disabled={!validEmail || inviting}>
          {#if inviting}<Spinner size={12} />{/if}
          Inviter
        </button>
      </div>
      <p class="hint">La personne doit déjà avoir un compte sur ce serveur.</p>
    </form>
  {/if}

  <ul class="list" aria-label="Membres du pool">
    {#each members as m (m.user_id)}
      <li class="row">
        <Avatar id={m.user_id} name={m.display_name} size={28} />
        <div class="who">
          <span class="name" title={m.display_name}>
            {m.display_name}
            {#if m.user_id === me}<span class="you">(vous)</span>{/if}
          </span>
          <span class="email" title={m.email}>{m.email}</span>
        </div>
        <span class="role" class:owner={m.role === 'owner'}>{m.role === 'owner' ? 'Propriétaire' : 'Membre'}</span>
        {#if board.isOwner && m.role !== 'owner'}
          <button
            class="btn btn-sm row-action"
            class:btn-ghost={confirmId !== m.user_id}
            class:btn-danger={confirmId === m.user_id}
            type="button"
            disabled={removing === m.user_id}
            aria-label={confirmId === m.user_id ? `Confirmer le retrait de ${m.display_name}` : `Retirer ${m.display_name}`}
            onclick={() => remove(m.user_id)}
          >
            {#if removing === m.user_id}<Spinner size={12} />{/if}
            {confirmId === m.user_id ? 'Confirmer' : 'Retirer'}
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  {#snippet footer()}
    {#if !board.isOwner && me != null}
      <button
        class="btn btn-sm leave"
        class:btn-danger={confirmId === me}
        type="button"
        disabled={removing === me}
        onclick={() => me != null && remove(me)}
      >
        {#if removing === me}<Spinner size={12} />{/if}
        {confirmId === me ? 'Confirmer : quitter le pool' : 'Quitter le pool'}
      </button>
    {/if}
    <span class="count muted num">{members.length} membre{members.length > 1 ? 's' : ''}</span>
    <button class="btn btn-sm" type="button" onclick={() => (open = false)}>Fermer</button>
  {/snippet}
</Modal>

<style>
  .invite {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 16px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .invite-row {
    display: flex;
    gap: 8px;
  }

  .invite-row .btn {
    height: 34px;
    flex: none;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 6px 0;
  }

  .row + .row {
    border-top: 1px solid var(--border);
  }

  .who {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .you {
    margin-left: 4px;
    font-weight: 400;
    color: var(--text-muted);
  }

  .email {
    overflow: hidden;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .role {
    flex: none;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .role.owner {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .row-action {
    flex: none;
    min-width: 78px;
  }

  .row-action.btn-danger {
    background: var(--danger-soft);
    border-color: transparent;
    box-shadow: none;
  }

  .leave.btn-danger {
    background: var(--danger-soft);
    border-color: transparent;
  }

  .leave:not(.btn-danger) {
    color: var(--danger);
  }

  .count {
    margin-right: auto;
    font-size: 12px;
  }

  .leave + .count {
    margin-left: 4px;
  }
</style>
