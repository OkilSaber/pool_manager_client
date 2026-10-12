import { errorMessage } from '$lib/errors';

export type ToastKind = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const DURATION = 4000;

class Toasts {
  items = $state<Toast[]>([]);
  private next = 1;

  show(kind: ToastKind, message: string) {
    const id = this.next++;
    // Plus récent en bas, comme une pile qui monte ; on en garde 3 au maximum.
    this.items = [...this.items, { id, kind, message }].slice(-3);
    setTimeout(() => this.dismiss(id), DURATION);
  }

  /** Erreur (ou message) : les messages du serveur, en minuscules, prennent une majuscule initiale. */
  error(e: unknown) {
    this.show('error', errorMessage(e));
  }

  success(message: string) {
    this.show('success', message);
  }

  info(message: string) {
    this.show('info', message);
  }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toast = new Toasts();
