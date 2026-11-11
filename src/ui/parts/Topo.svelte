<script lang="ts">
  import { store as s, conn, keyLineMember } from '../../lib/store.svelte';
  import { rateParts, duration, latClass } from '../../lib/format';
  import { pauseOffscreen } from '../attach';

  const down = $derived(rateParts((s.speedDown.at(-1) ?? 0) * 1024 * 1024));
  const up = $derived(rateParts((s.speedUp.at(-1) ?? 0) * 1024 * 1024));
  const hasF50 = !!conn.ufi;
  const short = (v: string | undefined, d: string) => (v ? v.split(/\s+/).at(-1)! : d);
  const f50Name = $derived(short(s.ufi?.model, 'F50'));
  const routerName = $derived(short(s.board?.model, '路由器'));
  const exitName = $derived(s.proxies ? keyLineMember() ?? '出口' : '出口');
  const radio = $derived(s.ufi ? `${s.ufi.signal.network.startsWith('5G') ? '5G' : '4G'} ${s.ufi.signal.bands[0] ?? ''}` : '');
  const kind = conn.profile.mihomo?.kind ?? 'mihomo';
  const delay = $derived.by(() => {
    const m = keyLineMember(); const g = s.proxies?.groups.find(x => x.name === m);
    return g ? s.proxies!.nodes[g.now]?.delay ?? null : null;
  });
  // 没有 F50 时路由器左移，只画路由器 → 出口一段
  const rx = hasF50 ? 140 : 60;
</script>

<section class="card topo full" {@attach pauseOffscreen}>
  <div class="lbl">实时链路<span class="r mono dim">{s.conns?.connections.length ?? 0} 连接</span></div>
  <div class="speeds" style="margin-top:10px">
    <div><span class="arr lime">↓</span><b class="disp">{down[0]}</b><u>{down[1]}</u></div>
    <div class="up"><span class="arr" style="color:var(--sky)">↑</span><b class="disp">{up[0]}</b><u>{up[1]}</u></div>
  </div>
  <svg class="map" viewBox="0 0 340 128" aria-hidden="true">
    {#if hasF50}
      <path class="wire" d="M70 64 C 105 64, 115 64, 140 64" />
      <path class="wire-hot" d="M70 64 C 105 64, 115 64, 140 64" pathLength="318" />
      <path class="wire-hot b" d="M70 64 C 105 64, 115 64, 140 64" pathLength="318" />
    {/if}
    <path class="wire" d="M{rx + 66} 64 C {rx + 92} 64, 245 64, 270 64" />
    <path class="wire-hot" d="M{rx + 66} 64 C {rx + 92} 64, 245 64, 270 64" pathLength="318" />
    <path class="wire-hot b" d="M{rx + 66} 64 C {rx + 92} 64, 245 64, 270 64" pathLength="318" />
    {#if hasF50}
      <g transform="translate(14 30)">
        <ellipse cx="28" cy="74" rx="26" ry="5" fill="#000" opacity=".25" />
        <rect x="4" y="2" width="48" height="66" rx="12" fill="url(#gF)" stroke="rgba(255,255,255,.12)" />
        <rect x="11" y="10" width="34" height="22" rx="5" fill="#0c0e0f" />
        <text x="28" y="25" text-anchor="middle" font-family="Geist Mono, monospace" font-size="9" font-weight="700" fill="#d4ff3a">{s.ufi?.signal.network.startsWith('4G') ? '4G' : '5G'}</text>
        <circle cx="28" cy="50" r="5" fill="none" stroke="#d4ff3a" stroke-width="1.5" opacity=".8" />
        <rect x="22" y="62" width="12" height="2" rx="1" fill="#6c7378" />
      </g>
    {/if}
    <g transform="translate({rx} 28)">
      <ellipse cx="33" cy="76" rx="32" ry="5" fill="#000" opacity=".25" />
      <rect x="10" y="0" width="5" height="34" rx="2.5" fill="#d9dbd4" transform="rotate(-12 12 34)" />
      <rect x="51" y="0" width="5" height="34" rx="2.5" fill="#d9dbd4" transform="rotate(12 54 34)" />
      <rect x="2" y="30" width="62" height="40" rx="10" fill="url(#gT)" stroke="rgba(0,0,0,.08)" />
      <circle class="blink-a" cx="14" cy="50" r="2.6" fill="#45d483" />
      <circle cx="23" cy="50" r="2.6" fill="#45d483" />
      <circle class="blink-b" cx="32" cy="50" r="2.6" fill="#d4ff3a" />
      <rect x="42" y="47" width="14" height="6" rx="3" fill="#b4b7af" />
    </g>
    <g transform="translate(272 32)">
      <circle cx="30" cy="32" r="30" fill="url(#gG)" />
      <ellipse cx="30" cy="32" rx="12" ry="30" fill="none" stroke="rgba(20,26,0,.35)" />
      <path d="M1 32h58M5 18h50M5 46h50" stroke="rgba(20,26,0,.3)" fill="none" />
      <circle cx="20" cy="26" r="3.2" fill="#141a00" />
      <circle class="ripple" cx="20" cy="26" r="3.2" fill="none" stroke="#141a00" />
    </g>
    {#if hasF50}<text class="node-lbl" x="42" y="122" text-anchor="middle">{f50Name}</text>{/if}
    <text class="node-lbl" x={rx + 33} y="122" text-anchor="middle">{routerName}</text>
    <text class="node-lbl" x="302" y="122" text-anchor="middle">{exitName}</text>
    {#if hasF50}<text class="node-sub" x="105" y="56" text-anchor="middle">{radio}</text>{/if}
    <text class="node-sub" x={(rx + 66 + 270) / 2} y="56" text-anchor="middle">{kind}</text>
  </svg>
  <div class="legs">
    {#if s.ufi}
      <div><small>{s.ufi.signal.network.startsWith('4G') ? '4G' : '5G'} 信号</small><b class={s.ufi.signal.rsrp > -100 ? 'ok' : 'warn'}>−{Math.abs(s.ufi.signal.rsrp)} dBm</b></div>
    {:else}
      <div><small>在线设备</small><b>{s.clients.length} 台</b></div>
    {/if}
    <div><small>WAN 在线</small><b>{s.status ? duration(s.status.wan.uptime) : '—'}</b></div>
    <div><small>代理延迟</small><b class={latClass(delay)}>{delay == null ? '—' : delay + ' ms'}</b></div>
  </div>
</section>
