<script lang="ts">
  let { on, onchange, label = '' }: { on: boolean; onchange: (on: boolean) => void; label?: string } = $props();
</script>

<span class="sw" class:on role="switch" aria-checked={on} aria-label={label} tabindex="0"
  onclick={() => onchange(!on)}
  onkeydown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onchange(!on))}></span>
