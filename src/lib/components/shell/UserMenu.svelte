<!-- Menu du compte (barre d'application) : identité, paramètres du serveur, mises à jour, déconnexion. -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import Avatar from '$lib/components/Avatar.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { updates } from '$lib/stores/updates.svelte';
  import DropdownMenu from './DropdownMenu.svelte';
  import MenuItem from './MenuItem.svelte';
  import { truncatedTitle } from './truncate';

  let open = $state(false);
</script>

{#if session.user}
  {@const user = session.user}
  <DropdownMenu label="Menu du compte" align="end" width={232} bind:open>
    {#snippet trigger(props)}
      <button {...props} class="trigger" class:open>
        <span class="avatar" aria-hidden="true"><Avatar id={user.id} name={user.display_name} size={22} /></span>
        <span class="name" {@attach truncatedTitle}>{user.display_name}</span>
        <svg class="chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 4l2.5 2.5L7.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    {/snippet}

    {#snippet header()}
      <div class="identity">
        <span class="identity-name" {@attach truncatedTitle}>{user.display_name}</span>
        <span class="identity-email" {@attach truncatedTitle}>{user.email}</span>
      </div>
    {/snippet}

    <MenuItem onselect={() => goto('/settings')}>
      {#snippet icon()}
        <svg width="14" height="14" viewBox="0 0 16 16">
          <rect x="2" y="2.5" width="12" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <rect x="2" y="9" width="12" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <circle cx="4.75" cy="4.75" r="0.85" fill="currentColor" />
          <circle cx="4.75" cy="11.25" r="0.85" fill="currentColor" />
        </svg>
      {/snippet}
      Paramètres du serveur
    </MenuItem>
    <MenuItem onselect={() => updates.check(true)} disabled={updates.checking}>
      {#snippet icon()}
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path
            d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.75v2.5h-2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      {/snippet}
      Rechercher des mises à jour
      <span class="version num">v{updates.current}</span>
    </MenuItem>
    <MenuItem onselect={() => session.logout()}>
      {#snippet icon()}
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path
            d="M6.5 2.75H4A1.25 1.25 0 0 0 2.75 4v8c0 .69.56 1.25 1.25 1.25h2.5M10.5 11l3-3-3-3M13.25 8H6.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      {/snippet}
      Se déconnecter
    </MenuItem>
  </DropdownMenu>
{/if}

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    max-width: 260px;
    /* 1 px de bordure + 4 px = 5 px autour de l'avatar de 22 px, comme en haut et en bas */
    padding: 0 8px 0 4px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-hover) ease;
  }

  .trigger:active {
    transform: scale(0.97);
  }

  /* Menu ouvert : surbrillance immédiate (sans fondu) — à l'ouverture au clavier le menu apparaît
     instantanément, le déclencheur ne doit pas arriver après lui. */
  .trigger.open {
    background: var(--surface-2);
    transition: transform var(--dur-press) var(--ease-out);
  }

  .trigger:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  /* L'avatar porte un title : sans ceci, une infobulle native répéterait le nom déjà affiché à côté. */
  .avatar {
    display: inline-flex;
    pointer-events: none;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    flex: none;
    color: var(--text-subtle);
  }

  .version {
    margin-left: 4px;
    font-size: 11.5px;
    color: var(--text-subtle);
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .identity-name,
  .identity-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity-name {
    font-size: 13px;
    font-weight: 600;
  }

  .identity-email {
    font-size: 12px;
    color: var(--text-muted);
  }

  @media (hover: hover) and (pointer: fine) {
    .trigger:hover {
      background: var(--surface-2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .trigger:active {
      transform: none;
    }
  }
</style>
