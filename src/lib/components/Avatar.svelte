<script lang="ts">
  import { hue, initials } from '$lib/avatar';

  let { id, name, size = 24, ring = false }: { id: number; name: string; size?: number; ring?: boolean } = $props();
</script>

<span
  class="avatar"
  class:ring
  style:--h={hue(id)}
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.42)}px"
  title={name}
  aria-label={name}
>
  {initials(name)}
</span>

<style>
  .avatar {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: hsl(var(--h) 55% 28%);
    background: hsl(var(--h) 70% 88%);
  }
  .ring {
    box-shadow: 0 0 0 2px var(--surface);
  }
  @media (prefers-color-scheme: dark) {
    .avatar {
      color: hsl(var(--h) 70% 85%);
      background: hsl(var(--h) 35% 30%);
    }
  }
</style>
