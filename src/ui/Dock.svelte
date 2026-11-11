<script lang="ts">
  import { ui, dockKeep, dockRevert } from '../lib/ui.svelte';
  const C = 150.8;
  const d = $derived(ui.dock!);
  const offset = $derived(d.done ? 0 : C * (1 - d.left / d.secs));
</script>

<section class="dock" class:ok={d.done === 'ok'} style="margin-bottom:12px">
  <div class="rg">
    <svg viewBox="0 0 56 56"><circle class="tr" cx="28" cy="28" r="24" /><circle class="pg" cx="28" cy="28" r="24" stroke-dasharray={C} stroke-dashoffset={offset} /></svg>
    <output>{d.done === 'ok' ? '✓' : d.done === 'rb' ? '↺' : d.left}</output>
  </div>
  <b>{d.title}</b>
  <p>{d.sub}</p>
  {#if !d.done}
    <div class="acts">
      <button class="btn" onclick={() => dockRevert()}>立即恢复</button>
      {#if d.keep}<button class="btn pri" onclick={() => dockKeep()}>保留更改</button>{/if}
    </div>
  {/if}
</section>
