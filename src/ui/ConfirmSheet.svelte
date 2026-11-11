<script lang="ts">
  import { ui, closeAsk, type AskOptions } from '../lib/ui.svelte';
  import { settings } from '../lib/store.svelte';
  import { haptic } from '../lib/native';
  import Icon from './parts/Icon.svelte';

  const MARK = { w: '!', r: '↺', x: '×', i: '→' } as const;
  let last = $state.raw<AskOptions | null>(null);
  $effect(() => { if (ui.confirm) last = ui.confirm; });
  const c = $derived(ui.confirm ?? last);
  const hz = $derived(c?.hz ?? true);

  let btn: HTMLButtonElement | undefined = $state();
  // 定时器判定是否按够时间，rAF 只画进度条：掉帧或降频时确认也不会卡住
  let t0 = 0, raf = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const setP = (p: number) => btn?.style.setProperty('--p', String(p));
  function stop() { cancelAnimationFrame(raf); clearTimeout(timer); t0 = 0; setP(0); }
  function done() { stop(); haptic.success(); closeAsk(true); }
  function down() {
    if (!hz) return;
    haptic.tick();
    t0 = performance.now();
    timer = setTimeout(done, settings.holdMs);
    const step = (now: number) => {
      setP(Math.min(1, (now - t0) / settings.holdMs));
      if (t0) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function up() { if (t0) stop(); }
  function click() { if (!hz) done(); }
</script>

<svelte:window onkeydown={e => e.key === 'Escape' && ui.confirm && closeAsk(false)} />

<div class="scrim" class:show={!!ui.confirm} role="presentation" onclick={e => e.target === e.currentTarget && closeAsk(false)}>
  <div class="sheet" class:hz role="dialog" aria-modal="true" aria-labelledby="sh-t">
    <span class="grab"></span>
    {#if c}
      <div class="ico" style={hz ? '' : 'background:var(--lime-soft);color:var(--lime-t)'}><Icon name={c.icon ?? 'warn'} /></div>
      <h3 id="sh-t">{c.title}</h3>
      <p class="what">{c.what}</p>
      <ul class="impact">
        {#each c.impact as [k, t], i (i)}<li class={k}><i>{MARK[k]}</i><span>{t}</span></li>{/each}
      </ul>
      <div class="acts">
        <button class="btn" onclick={() => closeAsk(false)}>取消</button>
        <button class="btn ink hold" bind:this={btn} onpointerdown={down} onpointerup={up} onpointerleave={up} onpointercancel={up} onclick={click}>
          <i class="fill"></i><span>{c.ok ?? (hz ? `长按 ${settings.holdMs / 1000} 秒确认` : '确认')}</span>
        </button>
      </div>
    {/if}
  </div>
</div>
