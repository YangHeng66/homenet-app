<script lang="ts">
  import { store as s, conn } from '../../lib/store.svelte';
  import { chartPath, rateParts } from '../../lib/format';
  import { toast } from '../../lib/ui.svelte';

  const W = 300, H = 96, MAX = 8;
  // 只改 path 的 d 属性，点数固定，不重建节点
  const d = $derived(s.speedDown.length > 1 ? chartPath(s.speedDown, W, H, MAX) : '');
  const u = $derived(s.speedUp.length > 1 ? chartPath(s.speedUp.map(v => v * 4), W, H, MAX) : '');
  const area = $derived(d ? `${d} L${W} ${H} L0 ${H}Z` : '');
  const down = $derived(rateParts((s.speedDown.at(-1) ?? 0) * 1048576));
  const up = $derived(rateParts((s.speedUp.at(-1) ?? 0) * 1048576));
  let range = $state<'live' | 'h' | 'd'>('live');
  function pick(r: typeof range) {
    if (r !== 'live') { toast(conn.plugin ? '历史曲线要等插件记录（M3）' : '历史曲线需要路由器插件'); return; }
    range = r;
  }
</script>

<section class="card speed pad">
  <div class="lbl">网速<span class="r"><span class="seg-mini">
    <button class:on={range === 'live'} onclick={() => pick('live')}>实时</button>
    <button class:on={range === 'h'} onclick={() => pick('h')}>1 小时</button>
    <button class:on={range === 'd'} onclick={() => pick('d')}>今天</button>
  </span></span></div>
  <div class="big">
    <div><b>{down[0]}</b><u>{' '}{down[1]} 下载</u></div>
    <div class="up"><b>{up[0]}</b><u>{' '}{up[1]} 上传</u></div>
  </div>
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--lime)" stop-opacity=".35" /><stop offset="1" stop-color="var(--lime)" stop-opacity="0" /></linearGradient></defs>
    <path d={area} fill="url(#sg)" />
    <path d={d} fill="none" stroke="var(--lime)" stroke-width="2" vector-effect="non-scaling-stroke" />
    <path d={u} fill="none" stroke="var(--sky)" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
  </svg>
</section>
