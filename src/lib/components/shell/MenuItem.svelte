<!--
  Élément de DropdownMenu. Navigation aux flèches (tabindex -1 : hors de l'ordre de tabulation).
  La surbrillance est portée par le focus, qui suit le pointeur (souris uniquement) : une seule ligne
  est mise en avant, que l'on navigue à la souris, aux flèches, ou en alternant les deux.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getMenuContext } from './DropdownMenu.svelte';

  let {
    onselect,
    danger = false,
    disabled = false,
    icon,
    children
  }: {
    onselect?: () => void;
    danger?: boolean;
    disabled?: boolean;
    icon?: Snippet;
    children: Snippet;
  } = $props();

  const menu = getMenuContext();

  function onpointermove(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || disabled) return;
    const el = e.currentTarget as HTMLElement;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  }

  function onpointerleave(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    if (document.activeElement === e.currentTarget) menu.release();
  }
</script>

<button
  type="button"
  role="menuitem"
  tabindex="-1"
  class="item"
  class:danger
  {disabled}
  onclick={(e) => menu.select(e, onselect)}
  {onpointermove}
  {onpointerleave}
>
  {#if icon}
    <span class="icon" aria-hidden="true">{@render icon()}</span>
  {/if}
  <span class="text">{@render children()}</span>
</button>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    /* Pas de transition : la surbrillance suit le pointeur/les flèches instantanément, comme un menu natif. */
  }

  .icon {
    display: inline-flex;
    width: 16px;
    justify-content: center;
    color: var(--text-muted);
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .danger,
  .danger .icon {
    color: var(--danger);
  }

  /* Focus = surbrillance (clavier comme souris) : pas d'anneau, un fond. */
  .item:focus {
    outline: none;
    background: var(--surface-2);
  }

  .item:focus .icon {
    color: var(--text);
  }

  .danger:focus {
    background: var(--danger-soft);
  }

  .danger:focus .icon {
    color: var(--danger);
  }

  .item:active:not(:disabled) {
    background: var(--surface-3);
  }

  .danger:active:not(:disabled) {
    background: var(--danger-soft);
  }

  .item:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
