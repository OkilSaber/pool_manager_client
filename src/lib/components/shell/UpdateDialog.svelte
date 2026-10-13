<!-- Nouvelle version : notes de la release GitHub, téléchargement (page de la release) ou version ignorée. -->
<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { fmtCreated } from '$lib/format';
  import { updates } from '$lib/stores/updates.svelte';

  const release = $derived(updates.latest);

  type Block = { kind: 'h' | 'li' | 'p'; parts: { text: string; bold: boolean }[] };

  /**
   * Rendu minimal du markdown des notes de version, sans HTML injecté : titres, puces (lignes de
   * continuation rattachées à la puce précédente), paragraphes, **gras** et texte des liens ; le reste en texte brut.
   */
  function blocks(md: string): Block[] {
    const out: Block[] = [];
    let last: { kind: Block['kind']; text: string } | null = null;
    const raw: { kind: Block['kind']; text: string }[] = [];
    for (const line of md.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) {
        last = null;
        continue;
      }
      const h = /^#{1,6}\s+(.*)$/.exec(t);
      const li = /^[-*]\s+(.*)$/.exec(t);
      if (h) raw.push((last = { kind: 'h', text: h[1] }));
      else if (li) raw.push((last = { kind: 'li', text: li[1] }));
      else if (last && last.kind !== 'h') last.text += ` ${t}`;
      else raw.push((last = { kind: 'p', text: t }));
    }
    for (const b of raw) {
      const text = b.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      const parts = text.split('**').map((text, i) => ({ text: text.replace(/`/g, ''), bold: i % 2 === 1 }));
      out.push({ kind: b.kind, parts: parts.filter((p) => p.text) });
    }
    return out;
  }
</script>

<Modal bind:open={updates.dialogOpen} title="Mise à jour disponible" width={460}>
  {#if release}
    <p class="versions">
      <span class="muted num">v{updates.current}</span>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <strong class="num">v{release.version}</strong>
      <span class="muted date">publiée le {fmtCreated(release.publishedAt)}</span>
    </p>
    {#if release.notes}
      <div class="notes">
        {#each blocks(release.notes) as b, i (i)}
          <p class={b.kind}>
            {#each b.parts as part, j (j)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}
          </p>
        {/each}
      </div>
    {/if}
    <p class="hint muted">Le téléchargement ouvre la page de la version dans votre navigateur.</p>
  {/if}

  {#snippet footer()}
    <button class="btn btn-sm btn-ghost skip" type="button" onclick={() => updates.skip()}>Ignorer cette version</button>
    <button class="btn btn-sm" type="button" onclick={() => (updates.dialogOpen = false)}>Plus tard</button>
    <button class="btn btn-sm btn-primary" type="button" onclick={() => updates.download()}>Télécharger</button>
  {/snippet}
</Modal>

<style>
  .versions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
  }

  .versions svg {
    color: var(--text-subtle);
  }

  .date {
    margin-left: auto;
    font-size: 12px;
  }

  .notes {
    max-height: 240px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 12.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .notes p {
    margin: 0;
  }

  .notes .h {
    font-weight: 600;
    color: var(--text);
  }

  .notes .h:not(:first-child) {
    margin-top: 10px;
  }

  .notes .h + p {
    margin-top: 4px;
  }

  .notes .li {
    position: relative;
    padding-left: 14px;
  }

  .notes .li::before {
    content: '•';
    position: absolute;
    left: 2px;
    color: var(--text-subtle);
  }

  .notes .li + .li,
  .notes .p + .p {
    margin-top: 2px;
  }

  .hint {
    margin: 12px 0 0;
    font-size: 12px;
  }

  .skip {
    margin-right: auto;
  }
</style>
