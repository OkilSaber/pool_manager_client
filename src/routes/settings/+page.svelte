<script lang="ts">
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { api, DEFAULT_SERVER, getServerUrl, setServerUrl } from '$lib/api';
  import Spinner from '$lib/components/Spinner.svelte';
  import { easeOut } from '$lib/motion';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  /** Durée minimale de l'état « test en cours » : un spinner qui clignote une frame paraît être un bug. */
  const MIN_TESTING = 300;

  type Status = 'idle' | 'testing' | 'ok' | 'fail';

  /**
   * Nettoie la saisie : espaces, schéma http:// ajouté s'il manque, puis forme canonique
   * (schéma et hôte en minuscules, port par défaut retiré, ni barre finale, ni ?requête, ni #ancre —
   * l'URL sert de préfixe à « /api/… », une requête ou une ancre la casseraient).
   */
  function normalize(raw: string): string | null {
    let v = raw.trim();
    if (!v) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`;
    try {
      const u = new URL(v);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  /** Adresse enregistrée, sous la même forme canonique que la saisie (sinon « modifié » dès l'ouverture). */
  const current = () => normalize(getServerUrl()) ?? getServerUrl();

  let saved = $state(current());
  let url = $state(current());
  let status = $state<Status>('idle');
  /** Adresse à laquelle se rapporte `status`. */
  let testedUrl = $state<string | null>(null);
  let showInvalid = $state(false);
  let run = 0;
  let urlInput: HTMLInputElement;

  const normalized = $derived(normalize(url));
  const dirty = $derived(normalized !== null && normalized !== saved);
  /** Une saisie invalide reste enregistrable : l'envoi affiche alors l'erreur au lieu de ne rien faire. */
  const canSave = $derived(normalized === null || normalized !== saved);
  /** Le résultat d'un test ne vaut que pour l'adresse testée. */
  const shown: Status = $derived(testedUrl !== null && testedUrl === normalized ? status : 'idle');
  const backHref = $derived(session.user ? '/boards' : '/login');
  const backLabel = $derived(session.user ? 'Tableaux' : 'Connexion');

  function oninput() {
    showInvalid = false;
  }

  async function test() {
    if (shown === 'testing') return;
    if (!normalized) {
      showInvalid = true;
      return;
    }
    const target = normalized;
    const id = ++run;
    testedUrl = target;
    status = 'testing';
    // api.health abandonne au bout de quelques secondes (une IP absente du LAN bloquerait sinon longtemps).
    const [ok] = await Promise.all([api.health(target), new Promise((r) => setTimeout(r, MIN_TESTING))]);
    if (id !== run) return; // un test plus récent a été lancé
    status = ok ? 'ok' : 'fail';
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!normalized) {
      showInvalid = true;
      return;
    }
    const changed = normalized !== saved;
    setServerUrl(normalized);
    saved = current();
    url = saved;
    if (!changed) {
      toast.success('Serveur enregistré');
      return;
    }
    // Le jeton stocké appartient à l'ancien serveur : il ne doit pas partir vers le nouveau (en-tête
    // Authorization de chaque requête). Connecté, l'identité affichée et les données en mémoire sont
    // aussi celles de l'ancien serveur (les identifiants de tableaux s'y recoupent) : fin de session
    // locale, comme l'annonce la note sous le champ.
    const wasLoggedIn = session.user != null;
    session.clear();
    if (!wasLoggedIn) {
      toast.success('Serveur enregistré');
      return;
    }
    toast.success('Serveur enregistré. Connectez-vous à ce serveur.');
    await goto('/login');
  }

  function resetDefault() {
    url = DEFAULT_SERVER;
    showInvalid = false;
    // Le bouton disparaît (l'adresse est déjà la valeur par défaut) : le focus irait sur <body>.
    urlInput.focus();
  }
</script>

<svelte:head>
  <title>Paramètres du serveur · Pool Manager</title>
</svelte:head>

<div class="page">
  <div class="inner">
    <a class="back" href={backHref}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {backLabel}
    </a>

    <header class="head">
      <h1>Paramètres du serveur</h1>
      <p class="muted">Pool Manager se connecte à un serveur partagé par toute l'équipe.</p>
    </header>

    <form class="card card-surface" onsubmit={save} novalidate>
      <div class="body">
        <div class="field">
          <div class="label-row">
            <label class="label" for="server-url">Adresse du serveur</label>
            {#if normalized !== DEFAULT_SERVER}
              <button type="button" class="link-btn" onclick={resetDefault}>Valeur par défaut</button>
            {/if}
          </div>
          <input
            id="server-url"
            class="input mono"
            class:invalid={showInvalid}
            type="text"
            inputmode="url"
            autocomplete="url"
            autocapitalize="off"
            spellcheck="false"
            placeholder={DEFAULT_SERVER}
            aria-describedby="server-help"
            aria-invalid={showInvalid || undefined}
            bind:value={url}
            bind:this={urlInput}
            {oninput}
          />
          {#if showInvalid}
            <p id="server-help" class="help error" in:fade={{ duration: 150, easing: easeOut }}>
              Adresse invalide. Exemple : <span class="mono">http://192.168.1.20:8080</span>
            </p>
          {:else}
            <p id="server-help" class="help">
              Sur ce PC : <span class="mono">{DEFAULT_SERVER}</span>. Pour un serveur installé sur un autre PC du réseau local,
              utilisez son adresse IP, par exemple <span class="mono">http://192.168.1.20:8080</span>.
            </p>
          {/if}
        </div>

        {#if session.user && dirty}
          <p class="note" in:fade={{ duration: 150, easing: easeOut }}>
            Enregistrer vous déconnectera : reconnectez-vous ensuite avec un compte de ce serveur.
          </p>
        {/if}
      </div>

      <footer class="actions">
        <!-- Le libellé ne bouge pas : la progression puis le résultat s'affichent au même endroit, à droite. -->
        <button
          type="button"
          class="btn"
          onclick={test}
          disabled={shown !== 'testing' && !url.trim()}
          aria-disabled={shown === 'testing' || undefined}
          aria-busy={shown === 'testing'}
        >
          Tester la connexion
        </button>

        <span class="status" role="status" aria-live="polite">
          {#if shown === 'testing'}
            <span class="testing"><Spinner size={12} />Test en cours…</span>
          {:else if shown === 'ok'}
            <span class="dot ok" aria-hidden="true"></span>Connecté
          {:else if shown === 'fail'}
            <span class="dot fail" aria-hidden="true"></span>Injoignable
          {/if}
        </span>

        <button type="submit" class="btn btn-primary" disabled={!canSave}>Enregistrer</button>
      </footer>
    </form>
  </div>
</div>

<style>
  .page {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 40px 24px;
  }

  .inner {
    max-width: 560px;
    margin: 0 auto;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px 0 4px;
    margin-left: -4px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-hover) ease,
      color var(--dur-hover) ease;
  }

  .back:active {
    transform: scale(0.97);
  }

  .back:focus-visible {
    outline: none;
    box-shadow: var(--focus);
  }

  .head {
    margin: 20px 0 20px;
  }

  .head h1 {
    font-size: 20px;
    letter-spacing: -0.02em;
  }

  .head p {
    margin: 6px 0 0;
    font-size: 13px;
  }

  .card {
    overflow: hidden;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
  }

  .label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .link-btn {
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .help .mono {
    font-size: 11.5px;
    color: var(--text);
  }

  .input.invalid {
    border-color: var(--danger);
  }

  .input.invalid:focus {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent);
  }

  .help {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .help.error,
  .help.error .mono {
    color: var(--danger);
  }

  .note {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
  }

  .status {
    display: inline-flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
  }

  .testing {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-weight: 400;
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 999px;
  }

  .dot.ok {
    background: var(--success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent);
  }

  .dot.fail {
    background: var(--danger);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent);
  }

  @media (hover: hover) and (pointer: fine) {
    .back:hover {
      background: var(--surface-3);
      color: var(--text);
    }
    .link-btn:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .back:active {
      transform: none;
    }
  }
</style>
