<script lang="ts">
  import { onMount } from 'svelte';
  import { store as s, conn, go, serviceName, moduleError, refreshSpeed, refreshRouter, refreshUfi, refreshConns, refreshWifi, refreshClients, refreshReach, loadF50 } from '../../lib/store.svelte';
  import { poll } from '../../lib/poll';
  import { toast } from '../../lib/ui.svelte';
  import { applyScene, toggleRouterWifi, toggleF50Wifi, toggleData, toggleNikki, speedTest, updateAllSubs, resetWan, rebootF50 } from '../../lib/actions';
  import { ago, gb, mbs, latClass } from '../../lib/format';
  import type { IconName } from '../../lib/icons';
  import Icon from '../parts/Icon.svelte';
  import Topo from '../parts/Topo.svelte';
  import KeyLineCard from '../parts/KeyLineCard.svelte';
  import SpeedCard from '../parts/SpeedCard.svelte';
  import { clientColor, initials } from '../devices/client';
  import ModuleError from '../parts/ModuleError.svelte';

  onMount(() => {
    refreshWifi(); refreshClients(); loadF50();
    if (conn.mihomo && !s.providers.length) conn.mihomo.getProviders().then(p => (s.providers = p));
    if (Date.now() - s.reachAt > 60_000) refreshReach();
    return poll(() => Promise.all([refreshSpeed(), refreshRouter(), refreshUfi(), refreshConns()]));
  });

  let busy = $state<Record<string, boolean>>({});
  let lastSpeed = $state('');
  async function act(k: string, fn: () => Promise<unknown>) {
    busy[k] = true;
    try { await fn(); } finally { busy[k] = false; }
  }

  interface Tile { k: string; name: string; sub: string; ic: IconName; on?: boolean; hz?: boolean; na?: boolean; run: () => void }
  const mods = (['router', 'mihomo', 'ufi'] as const).filter(m => conn[m]);
  const speedNa = conn.ufi?.limits?.speedTest;
  const failed = $derived(mods.filter(m => moduleError(m)));
  const radio5 = $derived(s.radios.find(r => r.band === '5g'));
  const tiles = $derived.by(() => {
    const t: Tile[] = [];
    if (radio5) t.push({ k: 'w5', name: '路由 Wi-Fi', sub: radio5.up ? `5G · CH ${radio5.channel}` : '已关闭', ic: 'wifi', on: radio5.up, run: () => toggleRouterWifi(radio5.id) });
    if (s.ufiWifi) t.push({ k: 'fw', name: 'F50 Wi-Fi', sub: s.ufiWifi.on ? s.ufiWifi.ssid : '已关闭', ic: 'wifi', on: s.ufiWifi.on, run: toggleF50Wifi });
    if (s.ufi) t.push({ k: 'data', name: '移动数据', sub: s.ufi.dataOn ? s.ufi.pdp.replace('IPv4v6', 'IPv4+v6') : '已关闭', ic: 'cell', on: s.ufi.dataOn, run: toggleData });
    if (conn.mihomo && serviceName()) t.push({ k: 'nikki', name: serviceName()!, sub: s.nikkiRunning ? ({ rule: '规则模式', global: '全局模式', direct: '直连模式' })[s.mode] : '已停止', ic: 'shield', on: s.nikkiRunning, run: toggleNikki });
    if (conn.ufi) t.push({ k: 'speed', name: '测速', sub: speedNa ? '暂不支持' : lastSpeed || '带宽测试', ic: 'gauge', na: !!speedNa, run: () => (speedNa ? speedTest() : act('speed', async () => { await speedTest(); lastSpeed = '刚刚测过'; })) });
    if (conn.mihomo) t.push({ k: 'sub', name: '更新订阅', sub: s.providers.length ? ago(Math.max(...s.providers.map(p => p.updatedAt))) : '—', ic: 'sync', run: () => act('sub', updateAllSubs) });
    if (conn.router) t.push({ k: 'wan', name: '重置 WAN', sub: s.status?.wan.device ?? 'WAN', ic: 'plug', hz: true, run: resetWan });
    if (conn.ufi) t.push({ k: 'f50', name: '重启 F50', sub: '约 60 秒', ic: 'power', hz: true, run: rebootF50 });
    return t;
  });

  const temp = $derived(s.ufi?.temps.board ?? 0);
  const throttle = $derived(s.ufi?.temps.throttleAt ?? 60);
  const quota = $derived(s.usage?.quota ?? 100 * 1024 ** 3);
  const month = $derived(s.ufi?.monthBytes ?? s.usage?.daily.reduce((a, b) => a + b, 0) ?? 0);
  const online = $derived(s.clients.filter(c => c.online));
  const fastest = $derived(online.length ? online.reduce((a, b) => (b.rate.down > a.rate.down ? b : a)) : null);
  const reachAgo = $derived(s.reachAt ? ago(s.reachAt) : '');
</script>

<main class="page">
  {#if failed.length}
    <div class="errs full">{#each failed as m, i (m)}<ModuleError module={m} compact={i > 0} />{/each}</div>
  {/if}
  <Topo />

  {#if s.scenes.length}
    <div class="h2 full"><h2>场景</h2><button onclick={() => toast('场景编辑器还没做（M3 随插件一起做）')}>编辑</button></div>
    <div class="scenes full">
      {#each s.scenes as sc (sc.id)}
        <button class="scene" class:on={sc.id === s.activeScene} class:hz={sc.hazard} onclick={() => applyScene(sc.id)}>
          <span class="ic"><Icon name={sc.icon} /></span>
          <span><b>{sc.name}</b><small>{sc.desc.split('\n')[0]}<br />{sc.desc.split('\n')[1] ?? ''}</small></span>
        </button>
      {/each}
    </div>
  {/if}

  <KeyLineCard />
  <SpeedCard />

  <div class="bento">
    {#if s.ufi}
      <button class="card tile" onclick={() => go('dev')}>
        <div class="lbl">{s.ufi.signal.network.startsWith('4G') ? '4G' : '5G'} 信号</div>
        <div class="bars4">{#each [30, 55, 80, 100] as h, i (h)}<i class:on={i < s.ufi.signal.bars} style="height:{h}%"></i>{/each}</div>
        <div class="val disp">{s.ufi.signal.bands[0] ?? '—'}</div>
        <div class="cap mono">SINR {s.ufi.signal.sinr} · RSRQ −{Math.abs(s.ufi.signal.rsrq)}</div>
      </button>
      <button class="card tile" onclick={() => go('dev')}>
        <div class="lbl">F50 温度</div>
        <svg class="gauge" viewBox="0 0 120 70" aria-hidden="true">
          <defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="var(--mint)" /><stop offset=".6" stop-color="var(--lime)" /><stop offset="1" stop-color="var(--coral)" /></linearGradient></defs>
          <path d="M12 62a48 48 0 0 1 96 0" fill="none" stroke="var(--s3)" stroke-width="9" stroke-linecap="round" />
          <path d="M12 62a48 48 0 0 1 96 0" fill="none" stroke="url(#tg)" stroke-width="9" stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset={150.8 * (1 - Math.min(100, temp) / 100)} />
          <text x="60" y="58" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="24" fill="var(--ink)">{temp}°</text>
        </svg>
        <div class="cap mono" style="text-align:center">{throttle}° 起限速 · {temp < throttle ? `还差 ${throttle - temp}°` : '已在限速'}</div>
      </button>
    {/if}
    <button class="card tile" onclick={() => go(s.ufi ? 'dev' : 'more')}>
      <div class="lbl">本月流量</div>
      <div class="row-ring">
        <svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--s3)" stroke-width="8" /><circle cx="32" cy="32" r="26" fill="none" stroke="var(--sky)" stroke-width="8" stroke-linecap="round" stroke-dasharray="163.4" stroke-dashoffset={163.4 * (1 - Math.min(1, month / quota))} transform="rotate(-90 32 32)" /></svg>
        <div><div class="val disp" style="font-size:24px">{gb(month)}<u>GB</u></div><div class="cap mono">今日 {gb(s.ufi?.todayBytes ?? s.usage?.daily.at(-1) ?? 0, 2)} GB</div></div>
      </div>
    </button>
    <button class="card tile" onclick={() => go('dev')}>
      <div class="lbl">在线设备</div>
      <div class="avatars">{#each online.slice(0, 4) as c (c.mac)}<span style="background:{clientColor(c)}">{initials(c.name)}</span>{/each}</div>
      <div class="val disp">{online.length}<u>台</u></div>
      <div class="cap mono">{fastest ? `最快 ${fastest.name} ↓${mbs(fastest.rate.down)}MB/s` : '—'}</div>
    </button>
    {#if conn.mihomo}
      <section class="card tile w2">
        <div class="lbl">连通性 · 线路延迟<span class="r mono dim">{reachAgo}</span></div>
        <ul class="reach">
          {#each s.reach as r (r.name)}
            <li><i class={r.delay == null ? 'x' : r.delay < 200 ? '' : r.delay < 320 ? 'w' : 'x'}></i><span>{r.name} <span class="dim mono" style="font-size:11px" title={r.guessed ? '按规则名推测的分组，看到这个网站的实时连接后会以实际为准' : undefined}>{r.via}{r.guessed ? ' · 推测' : ''}</span></span><b class={latClass(r.delay)}>{r.delay == null ? '超时' : r.delay + 'ms'}</b></li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>

  <div class="h2 full"><h2>快捷控制</h2>{#if conn.plugin}<button onclick={() => go('more')}>定时任务</button>{/if}</div>
  <div class="cc full">
    {#each tiles as t (t.k)}
      <button class="tg" class:on={t.on} class:hz={t.hz} class:na={t.na} class:busy={busy[t.k]} onclick={t.run}><Icon name={t.ic} /><span><b>{t.name}</b><small>{t.sub}</small></span></button>
    {/each}
  </div>
</main>
