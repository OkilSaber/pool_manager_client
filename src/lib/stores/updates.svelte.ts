// Vérification des mises à jour : compare la version de l'application à la dernière release GitHub.
// Vérifiée au lancement puis toutes les 6 h (API publique, 60 requêtes/h par IP : largement suffisant).

import { doFetch } from '$lib/api';
import { toast } from './toast.svelte';

const LATEST_URL = 'https://api.github.com/repos/OkilSaber/pool_manager_client/releases/latest';
const SKIP_KEY = 'pm.update.skip';
const FIRST_CHECK_MS = 3_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface Release {
  version: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

/** « v0.5.0 » → [0, 5, 0] ; `null` si ce n'est pas une version x.y.z. */
function parse(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? m.slice(1).map(Number) : null;
}

/** `a` est strictement plus récente que `b`. */
export function isNewer(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

class Updates {
  readonly current = __APP_VERSION__;
  latest = $state<Release | null>(null);
  checking = $state(false);
  /** Version ignorée (« Ignorer cette version ») : plus de signalement tant qu'il n'y en a pas de plus récente. */
  skipped = $state(localStorage.getItem(SKIP_KEY));
  dialogOpen = $state(false);

  /** Mise à jour disponible et non ignorée. */
  readonly available = $derived(
    this.latest != null && isNewer(this.latest.version, this.current) && this.latest.version !== this.skipped
      ? this.latest
      : null
  );

  private started = false;
  /** Dernière version déjà signalée par un toast : un seul toast par version et par lancement. */
  private announced: string | null = null;

  /** Lance les vérifications automatiques (une seule fois). */
  start() {
    if (this.started) return;
    this.started = true;
    setTimeout(() => this.check(), FIRST_CHECK_MS);
    setInterval(() => this.check(), INTERVAL_MS);
  }

  /**
   * Interroge GitHub. Automatique : silencieux en cas d'erreur, toast à la découverte d'une version.
   * Manuelle (menu du compte) : ouvre la fenêtre de mise à jour, ou dit que l'application est à jour.
   */
  async check(manual = false) {
    if (this.checking) return;
    this.checking = true;
    try {
      const res = await doFetch(LATEST_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          // Exigé par l'API GitHub ; envoyé par le plugin http de Tauri (ignoré par un navigateur).
          'User-Agent': `pool-manager/${this.current}`
        }
      });
      if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
      const r = (await res.json()) as GithubRelease;
      if (r.draft || r.prerelease || !parse(r.tag_name)) throw new Error('release inattendue');
      this.latest = {
        version: r.tag_name.replace(/^v/, ''),
        name: r.name || r.tag_name,
        notes: (r.body ?? '').trim(),
        url: r.html_url,
        publishedAt: r.published_at
      };
    } catch {
      if (manual) toast.error('Impossible de vérifier les mises à jour (GitHub injoignable)');
      return;
    } finally {
      this.checking = false;
    }

    const newer = isNewer(this.latest.version, this.current);
    if (manual) {
      if (newer) this.dialogOpen = true;
      else toast.success(`Pool Manager est à jour (v${this.current})`);
    } else if (this.available && this.announced !== this.available.version) {
      this.announced = this.available.version;
      toast.info(`Pool Manager v${this.available.version} est disponible`);
    }
  }

  /** Ne plus signaler cette version. */
  skip() {
    if (!this.latest) return;
    this.skipped = this.latest.version;
    localStorage.setItem(SKIP_KEY, this.latest.version);
    this.dialogOpen = false;
  }

  /** Ouvre la page de la release dans le navigateur par défaut. */
  async download() {
    if (!this.latest) return;
    const url = this.latest.url;
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } else {
        window.open(url, '_blank', 'noopener');
      }
      this.dialogOpen = false;
    } catch (e) {
      toast.error(e);
    }
  }
}

export const updates = new Updates();
