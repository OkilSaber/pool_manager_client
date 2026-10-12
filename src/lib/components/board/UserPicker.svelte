<!--
  Choix d'une personne inscrite sur le serveur : champ de recherche (nom ou email) + liste filtrée
  affichée sous le champ (combobox ARIA). ↑/↓ pour naviguer, Entrée pour choisir, Échap pour vider.
-->
<script lang="ts">
  import Avatar from '$lib/components/Avatar.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import type { User } from '$lib/types/User';

  let {
    users,
    loading = false,
    busy = false,
    onpick
  }: {
    /** Personnes proposables (déjà filtrées des membres actuels). */
    users: User[];
    loading?: boolean;
    busy?: boolean;
    onpick: (user: User) => void;
  } = $props();

  const uid = $props.id();
  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement;

  /** Comparaison sans accents ni casse : « ines » trouve « Inès ». */
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  const matches = $derived.by(() => {
    const q = fold(query.trim());
    const list = q ? users.filter((u) => fold(u.display_name).includes(q) || fold(u.email).includes(q)) : users;
    return list.slice(0, 50);
  });

  $effect(() => {
    // Nouvelle recherche : on repart du premier résultat.
    void query;
    active = 0;
  });

  function pick(user: User | undefined) {
    if (!user || busy) return;
    onpick(user);
    query = '';
    input?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, matches.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape' && query) {
      // Échap vide la recherche ; un second Échap ferme la fenêtre.
      e.preventDefault();
      e.stopPropagation();
      query = '';
    }
  }

  function scrollIntoView(node: HTMLElement, isActive: boolean) {
    const run = (on: boolean) => on && node.scrollIntoView({ block: 'nearest' });
    run(isActive);
    return { update: run };
  }
</script>

<div class="picker">
  <div class="field-wrap">
    <svg class="search" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <input
      bind:this={input}
      class="input"
      type="text"
      role="combobox"
      aria-expanded="true"
      aria-controls="{uid}-list"
      aria-activedescendant={matches[active] ? `${uid}-opt-${matches[active].id}` : undefined}
      aria-autocomplete="list"
      aria-label="Rechercher une personne à inviter"
      placeholder="Rechercher par nom ou email…"
      autocomplete="off"
      spellcheck="false"
      bind:value={query}
      {onkeydown}
    />
    {#if busy}<span class="busy"><Spinner size={12} /></span>{/if}
  </div>

  <ul class="list" id="{uid}-list" role="listbox" aria-label="Personnes inscrites">
    {#if loading}
      <li class="empty" role="presentation"><Spinner size={12} /> Chargement des comptes…</li>
    {:else if matches.length === 0}
      <li class="empty" role="presentation">
        {users.length === 0 ? 'Tous les inscrits sont déjà membres du pool.' : 'Aucune personne ne correspond.'}
      </li>
    {:else}
      {#each matches as u, i (u.id)}
        <!-- Clavier géré par le champ (combobox + aria-activedescendant) : les options ne prennent pas le focus. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{uid}-opt-{u.id}"
          class="option"
          class:active={i === active}
          role="option"
          aria-selected={i === active}
          use:scrollIntoView={i === active}
          onpointermove={() => (active = i)}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => pick(u)}
        >
          <Avatar id={u.id} name={u.display_name} size={24} />
          <span class="who">
            <span class="name">{u.display_name}</span>
            <span class="email">{u.email}</span>
          </span>
          <span class="add" aria-hidden="true">Inviter</span>
        </li>
      {/each}
    {/if}
  </ul>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-wrap {
    position: relative;
  }
  .field-wrap .input {
    padding-left: 30px;
  }
  .search {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-subtle);
    pointer-events: none;
  }
  .busy {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    color: var(--text-muted);
  }
  .list {
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: 196px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .option.active {
    background: var(--surface-3);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    line-height: 1.25;
  }
  .name,
  .email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-weight: 500;
  }
  .email {
    font-size: 12px;
    color: var(--text-muted);
  }
  .add {
    font-size: 12px;
    font-weight: 500;
    color: var(--accent);
    opacity: 0;
  }
  .option.active .add {
    opacity: 1;
  }
  .empty {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 8px;
    font-size: 13px;
    color: var(--text-muted);
  }
</style>
