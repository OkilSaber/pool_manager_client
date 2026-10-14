// WebSocket texte minimale, commune à l'app et au navigateur.
// Dans Tauri, la connexion passe par le plugin websocket (Rust) : pas de blocage « mixed content » d'un `ws://`
// du réseau local depuis `tauri://`, comme pour le plugin http. Dans un navigateur (dev), WebSocket native.

import { isTauri } from './api';

export interface SocketHandlers {
  /** Connexion établie : on peut envoyer. */
  onopen: () => void;
  /** Message texte reçu. */
  onmessage: (text: string) => void;
  /** Connexion perdue ou impossible (appelé une seule fois, jamais après `close()`). */
  onclose: () => void;
}

export interface Socket {
  send: (text: string) => void;
  /** Ferme la connexion ; plus aucun rappel ensuite. */
  close: () => void;
}

/**
 * Le serveur envoie un ping toutes les 30 s. Le plugin les remonte : sans rien recevoir pendant ce délai,
 * la connexion est tenue pour morte (réseau coupé sans fermeture propre). Le navigateur ne montre pas les pings.
 */
const SILENCE_MS = 75_000;

export function openSocket(url: string, handlers: SocketHandlers): Socket {
  return isTauri ? openTauri(url, handlers) : openNative(url, handlers);
}

function openNative(url: string, h: SocketHandlers): Socket {
  let alive = true;
  const ws = new WebSocket(url);
  ws.onopen = () => alive && h.onopen();
  ws.onmessage = (e) => alive && typeof e.data === 'string' && h.onmessage(e.data);
  // Une erreur est toujours suivie de `close`.
  ws.onclose = () => {
    if (!alive) return;
    alive = false;
    h.onclose();
  };
  return {
    send: (text) => {
      if (alive && ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    close: () => {
      alive = false;
      ws.close();
    }
  };
}

function openTauri(url: string, h: SocketHandlers): Socket {
  type PluginSocket = import('@tauri-apps/plugin-websocket').default;
  let alive = true;
  let ws: PluginSocket | null = null;
  let silence: ReturnType<typeof setTimeout> | undefined;

  function end() {
    if (!alive) return;
    alive = false;
    clearTimeout(silence);
    void ws?.disconnect().catch(() => {});
    h.onclose();
  }

  function heard() {
    clearTimeout(silence);
    silence = setTimeout(end, SILENCE_MS);
  }

  import('@tauri-apps/plugin-websocket')
    .then(({ default: PluginSocket }) => PluginSocket.connect(url))
    .then((socket) => {
      if (!alive) {
        void socket.disconnect().catch(() => {});
        return;
      }
      ws = socket;
      // Le plugin remonte une erreur de lecture sous forme de chaîne (connexion réinitialisée, serveur arrêté…).
      socket.addListener((msg: unknown) => {
        if (!alive) return;
        if (msg == null || typeof msg !== 'object' || !('type' in msg)) return end();
        const m = msg as { type: string; data: unknown };
        if (m.type === 'Close') return end();
        heard();
        if (m.type === 'Text' && typeof m.data === 'string') h.onmessage(m.data);
      });
      heard();
      h.onopen();
    })
    .catch(end);

  return {
    send: (text) => {
      if (alive && ws) ws.send(text).catch(end);
    },
    close: () => {
      alive = false;
      clearTimeout(silence);
      void ws?.disconnect().catch(() => {});
    }
  };
}
