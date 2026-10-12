<script lang="ts">
  import { goto } from '$app/navigation';
  import { ApiError } from '$lib/api';
  import AuthCard from '$lib/components/shell/AuthCard.svelte';
  import BusyLabel from '$lib/components/shell/BusyLabel.svelte';
  import { errorMessage } from '$lib/errors';
  import FormError from '$lib/components/shell/FormError.svelte';
  import { session } from '$lib/stores/session.svelte';

  const MIN_PASSWORD = 8;

  let displayName = $state('');
  let email = $state('');
  let password = $state('');
  let pending = $state(false);
  let error = $state<string | null>(null);
  let unreachable = $state(false);
  /** Passe à vrai après une tentative d'envoi avec un mot de passe trop court. */
  let passwordFlagged = $state(false);
  /** Champ signalé par la dernière tentative d'envoi (bordure rouge, aria-invalid), effacé à la saisie. */
  let flagged = $state<'name' | 'email' | null>(null);
  let nameInput: HTMLInputElement;
  let emailInput: HTMLInputElement;
  let passwordInput: HTMLInputElement;

  /** Longueur en caractères (points de code), comme le serveur (`chars().count()`) : un emoji compte pour 1, pas 2. */
  const passwordLength = $derived([...password].length);
  const passwordOk = $derived(passwordLength >= MIN_PASSWORD);
  const passwordBad = $derived(passwordFlagged && !passwordOk);

  const focusOnMount = (el: HTMLElement) => el.focus();

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (pending) return;
    error = null;
    unreachable = false;
    flagged = null;

    // Chaque erreur de saisie envoie le focus sur le champ concerné.
    if (!displayName.trim()) {
      error = 'Indiquez le nom affiché auprès de votre équipe.';
      flagged = 'name';
      nameInput.focus();
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      error = 'Adresse email invalide.';
      flagged = 'email';
      emailInput.focus();
      return;
    }
    if (!passwordOk) {
      passwordFlagged = true;
      error = `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`;
      passwordInput.focus();
      return;
    }

    pending = true;
    try {
      await session.signup(email.trim(), displayName.trim(), password);
      // replaceState, comme la garde du layout (/signup → /pools dès que session.user est posé).
      await goto('/pools', { replaceState: true });
    } catch (err) {
      error = errorMessage(err);
      unreachable = err instanceof ApiError && err.status === 0;
      // 409 : un compte existe déjà avec cet email — le champ est prêt à être corrigé.
      if (err instanceof ApiError && err.status === 409) {
        flagged = 'email';
        emailInput.focus();
        emailInput.select();
      }
    } finally {
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>Créer un compte · Pool Manager</title>
</svelte:head>

<AuthCard title="Créer un compte" subtitle="Rejoignez les pools et projets de votre équipe.">
  <form class="form" onsubmit={submit} novalidate>
    <div class="field">
      <label class="label" for="signup-name">Nom affiché</label>
      <input
        id="signup-name"
        class="input"
        type="text"
        autocomplete="name"
        placeholder="Camille Martin"
        maxlength="80"
        class:invalid={flagged === 'name'}
        aria-invalid={flagged === 'name' || undefined}
        bind:value={displayName}
        bind:this={nameInput}
        oninput={() => flagged === 'name' && (flagged = null)}
        {@attach focusOnMount}
      />
    </div>

    <div class="field">
      <label class="label" for="signup-email">Email</label>
      <input
        id="signup-email"
        class="input"
        type="email"
        autocomplete="email"
        autocapitalize="off"
        spellcheck="false"
        placeholder="vous@exemple.fr"
        class:invalid={flagged === 'email'}
        aria-invalid={flagged === 'email' || undefined}
        bind:value={email}
        bind:this={emailInput}
        oninput={() => flagged === 'email' && (flagged = null)}
      />
    </div>

    <div class="field">
      <label class="label" for="signup-password">Mot de passe</label>
      <input
        id="signup-password"
        class="input"
        class:invalid={passwordBad}
        type="password"
        autocomplete="new-password"
        aria-describedby="signup-password-hint"
        aria-invalid={passwordBad || undefined}
        bind:value={password}
        bind:this={passwordInput}
      />
      <p id="signup-password-hint" class="hint" class:ok={passwordOk} class:bad={passwordBad}>
        <span class="hint-icon" aria-hidden="true">
          {#if passwordOk}
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2.5 6.25l2.25 2.25L9.5 3.75" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {:else}
            <svg width="12" height="12" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="2" fill="currentColor" />
            </svg>
          {/if}
        </span>
        Au moins {MIN_PASSWORD} caractères
        {#if passwordLength > 0 && !passwordOk}
          <span class="num">· {passwordLength}/{MIN_PASSWORD}</span>
        {/if}
      </p>
    </div>

    <!-- aria-disabled et non disabled pendant l'envoi : un bouton focalisé qui devient disabled perd le focus. -->
    <button class="btn btn-primary submit" type="submit" aria-disabled={pending || undefined} aria-busy={pending}>
      <BusyLabel busy={pending}>Créer mon compte</BusyLabel>
    </button>

    <FormError message={error} {unreachable} />
  </form>

  {#snippet alternate()}
    Déjà un compte ? <a href="/login">Se connecter</a>
  {/snippet}
</AuthCard>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .hint {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    font-size: 12px;
    /* text-muted et non text-subtle : une consigne doit rester lisible (contraste AA en clair comme en sombre). */
    color: var(--text-muted);
    /* Pas de transition : le changement suit la frappe, et l'icône (✓) bascule elle aussi instantanément. */
  }

  .hint-icon {
    display: inline-flex;
  }

  /* --success (#16a34a) sur blanc ≈ 3.3:1 à 12 px : assombri en clair pour passer AA ;
     en sombre il passe tel quel (~5.5:1 sur la surface). */
  .hint.ok {
    color: color-mix(in srgb, var(--success) 76%, black);
  }

  @media (prefers-color-scheme: dark) {
    .hint.ok {
      color: var(--success);
    }
  }

  .hint.bad {
    color: var(--danger);
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
