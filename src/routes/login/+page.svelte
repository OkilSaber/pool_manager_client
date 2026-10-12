<script lang="ts">
  import { goto } from '$app/navigation';
  import { ApiError } from '$lib/api';
  import AuthCard from '$lib/components/shell/AuthCard.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import { errorMessage } from '$lib/errors';
  import FormError from '$lib/components/shell/FormError.svelte';
  import { session } from '$lib/stores/session.svelte';

  let email = $state('');
  let password = $state('');
  let pending = $state(false);
  let error = $state<string | null>(null);
  let unreachable = $state(false);
  /** Champ vide signalé après une tentative d'envoi (bordure rouge, aria-invalid). */
  let missing = $state<'email' | 'password' | null>(null);
  let emailInput: HTMLInputElement;
  let passwordInput: HTMLInputElement;

  const focusOnMount = (el: HTMLElement) => el.focus();

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (pending) return;
    // Nouvelle tentative : l'ancien message disparaît tout de suite (pas d'animation sur Entrée).
    error = null;
    unreachable = false;
    missing = null;

    if (!email.trim() || !password) {
      error = 'Renseignez votre email et votre mot de passe.';
      // Le focus va directement au premier champ à compléter.
      missing = !email.trim() ? 'email' : 'password';
      (missing === 'email' ? emailInput : passwordInput).focus();
      return;
    }

    pending = true;
    try {
      await session.login(email.trim(), password);
      // replaceState, comme la garde du layout qui redirige aussi /login → /boards dès que session.user est
      // posé : les deux navigations se recouvrent, et « Précédent » ne doit pas ramener à l'écran de connexion.
      await goto('/boards', { replaceState: true });
    } catch (err) {
      error = errorMessage(err);
      unreachable = err instanceof ApiError && err.status === 0;
      // Identifiants refusés — le serveur répond 400 « email ou mot de passe incorrect » (401 gardé par
      // sécurité) : le mot de passe est sélectionné, prêt à être retapé.
      if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
        passwordInput.focus();
        passwordInput.select();
      }
    } finally {
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>Connexion · Pool Manager</title>
</svelte:head>

<AuthCard title="Connexion" subtitle="Accédez aux tableaux de votre équipe.">
  <form class="form" onsubmit={submit} novalidate>
    <div class="field">
      <label class="label" for="login-email">Email</label>
      <input
        id="login-email"
        class="input"
        type="email"
        autocomplete="username"
        autocapitalize="off"
        spellcheck="false"
        placeholder="vous@exemple.fr"
        class:invalid={missing === 'email'}
        aria-invalid={missing === 'email' || undefined}
        bind:value={email}
        bind:this={emailInput}
        oninput={() => missing === 'email' && (missing = null)}
        {@attach focusOnMount}
      />
    </div>

    <div class="field">
      <label class="label" for="login-password">Mot de passe</label>
      <input
        id="login-password"
        class="input"
        type="password"
        autocomplete="current-password"
        class:invalid={missing === 'password'}
        aria-invalid={missing === 'password' || undefined}
        bind:value={password}
        bind:this={passwordInput}
        oninput={() => missing === 'password' && (missing = null)}
      />
    </div>

    <!-- aria-disabled et non disabled pendant l'envoi : un bouton focalisé qui devient disabled perd le focus
         (renvoyé sur <body>) ; le double envoi est déjà bloqué dans submit(). -->
    <button class="btn btn-primary submit" type="submit" aria-disabled={pending || undefined} aria-busy={pending}>
      <BusyLabel busy={pending}>Se connecter</BusyLabel>
    </button>

    <FormError message={error} {unreachable} />
  </form>

  {#snippet alternate()}
    Pas encore de compte ? <a href="/signup">Créer un compte</a>
  {/snippet}
</AuthCard>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .input.invalid {
    border-color: var(--danger);
  }

  .input.invalid:focus {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent);
  }

  .submit {
    width: 100%;
    height: 36px;
    margin-top: 4px;
  }
</style>
