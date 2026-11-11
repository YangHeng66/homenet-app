<script lang="ts">
  import { store as s, conn } from '../../lib/store.svelte';
  import { openSheet, toast } from '../../lib/ui.svelte';
  import { POLICY, resetWan, rebootRouter, toggleRouterWifi, setChannel, setPort, restartNetwork, backupRouter } from '../../lib/actions';
  import { mbs } from '../../lib/format';
  import Icon from '../parts/Icon.svelte';
  import Switch from '../parts/Switch.svelte';
  import Chan from '../parts/Chan.svelte';
  import Ring from '../parts/Ring.svelte';
  import { clientColor, clientIcon, linkText } from './client';
  import ModuleError from '../parts/ModuleError.svelte';

  const st = $derived(s.status);
  const b = $derived(s.board);
  const r5 = $derived(s.radios.find(r => r.band === '5g'));
  const r2 = $derived(s.radios.find(r => r.band === '2g'));
  let guest = $state(false);

  const DAY = 86_400_000;
  const ticks = $derived(s.wanEvents.map(t => ((t - (Date.now() - DAY)) / DAY) * 100).filter(p => p >= 0 && p <= 100));
  const axis = $derived.by(() => {
    const n = Date.now();
    return [24, 18, 12, 6].map(h => { const d = new Date(n - h * 3600_000); return `${h === 24 ? '昨 ' : ''}${String(d.getHours()).padStart(2, '0')}:00`; }).concat('现在');
  });
  const kind = conn.profile.mihomo?.kind ?? 'mihomo';
</script>

{#if !(st && b)}<ModuleError module="router" />{/if}

{#if st && b}
  <section class="card hero-dev full">
    <svg viewBox="0 0 120 120"><ellipse cx="60" cy="108" rx="44" ry="6" fill="#000" opacity=".25" /><rect x="26" y="14" width="8" height="52" rx="4" fill="#d9dbd4" transform="rotate(-12 30 66)" /><rect x="86" y="14" width="8" height="52" rx="4" fill="#d9dbd4" transform="rotate(12 90 66)" /><rect x="14" y="58" width="92" height="46" rx="14" fill="url(#gT)" /><circle cx="32" cy="81" r="3.5" fill="#45d483" /><circle cx="44" cy="81" r="3.5" fill="#45d483" /><circle cx="56" cy="81" r="3.5" fill="#d4ff3a" /><rect x="72" y="77" width="22" height="8" rx="4" fill="#b4b7af" /></svg>
    <div>
      <div class="lbl">{b.model} · {b.release}</div>
      <h3>{st.wan.up ? `WAN 在线 ${Math.floor(st.wan.uptime / 3600)}h` : 'WAN 离线'}</h3>
      <div class="chips2">{#if conn.mihomo}<span class:ok={s.nikkiRunning}>{kind} {s.nikkiRunning ? '运行中' : '已停止'}</span>{/if}<span>{st.lanIp}</span>{#if st.wan.speedMbps}<span>{st.wan.speedMbps}M</span>{/if}</div>
    </div>
  </section>

  <section class="card pad">
    <div class="lbl">系统</div>
    <div class="rings3">
      <Ring pct={st.cpu} color="var(--lime)" text="{st.cpu}%" label="CPU" />
      <Ring pct={st.memory} color="var(--sky)" text="{st.memory}%" label="内存" />
      {#if st.temperature != null}<Ring pct={st.temperature} color="var(--mint)" text="{st.temperature}°" label="温度" />
      {:else}<Ring pct={st.load[0] * 100} color="var(--mint)" text={st.load[0].toFixed(2)} label="负载" size={15} />{/if}
    </div>
    {#if conn.plugin}
      <div class="lbl" style="margin-top:18px">WAN 稳定性 · 24h<span class="r mono {ticks.length ? 'bad' : 'ok'}">{ticks.length ? `断开 ${ticks.length} 次` : '没有断开'}</span></div>
      <div class="timeline">{#each ticks as p, i (i)}<i style="left:{p}%"></i>{/each}</div>
      <div class="tl-axis">{#each axis as a (a)}<span>{a}</span>{/each}</div>
    {/if}
    <div class="actions"><button class="btn" onclick={resetWan}>重置 WAN 口</button><button class="btn danger" onclick={rebootRouter}>重启路由器</button></div>
  </section>

  {#if r5 || r2}
    <section class="card pad">
      <div class="lbl">Wi-Fi · {(r5 ?? r2)!.ssid}</div>
      {#if r5}
        <div class="swrow"><b>5G</b><Switch on={r5.up} onchange={() => toggleRouterWifi(r5.id)} label="5G Wi-Fi" /><small>{r5.up ? `${r5.htmode} · ${r5.clients} 台设备` : '已关闭'}</small></div>
        <Chan options={r5.channels.map(c => [c, c === 'auto' ? '自动' : c] as [string, string])} value={r5.channel} onpick={c => setChannel(r5.id, c)} />
      {/if}
      {#if r2}
        <div class="swrow"><b>2.4G</b><Switch on={r2.up} onchange={() => toggleRouterWifi(r2.id)} label="2.4G Wi-Fi" /><small>{r2.up ? `${r2.htmode} · ${r2.clients} 台设备` : '已关闭'}</small></div>
      {/if}
      <div class="swrow"><b>访客网络</b><Switch on={guest} onchange={v => { guest = v; toast('访客网络还没接入'); }} label="访客网络" /><small>隔离内网 · 不走代理</small></div>
    </section>
  {/if}

  <section class="card pad full">
    <div class="lbl">在线设备<span class="r mono dim">{s.clients.length} 台 · 点设备单独管理</span></div>
    <ul class="clients">
      {#each s.clients as c (c.mac)}
        {@const ctl = s.controls[c.mac]}
        {@const color = clientColor(c)}
        <li data-cl class:off={ctl?.blocked}><button class="cl-row" onclick={() => openSheet({ kind: 'client', mac: c.mac })}>
          <span class="av" style="background:{color}38;color:{color}"><Icon name={clientIcon(c)} /></span>
          <b>{c.name}{#if c.isSelf}<em class="tag me">本机</em>{/if}{#if ctl && ctl.policy !== 'rule'}<em class="tag">{POLICY.find(p => p.k === ctl.policy)?.short}</em>{/if}{#if ctl?.limitMbps}<em class="tag">限速 {ctl.limitMbps}M</em>{/if}{#if ctl?.blocked}<em class="tag bad">已暂停</em>{/if}</b>
          <span class="spd">{#if ctl?.blocked}<span class="dim">—</span>{:else}↓{mbs(c.rate.down)} MB/s<br /><span class="up">↑{mbs(c.rate.up)}</span>{/if}</span>
          <small>{c.ip} · {linkText(c)}</small>
        </button></li>
      {/each}
    </ul>
  </section>

  {#if s.ports}
    <section class="card pad full trset">
      <div class="blk">
        <div class="lbl">网口</div>
        <div class="swrow"><b>WAN 看门狗</b><Switch on={s.ports.wanWatchdog} onchange={v => setPort('wanWatchdog', v)} label="WAN 看门狗" /><small>上游连续 ping 不通就重置 {st.wan.device} · 今天重置 {s.ports.watchdogResetsToday} 次</small></div>
        <div class="swrow"><b>关闭节能以太网（EEE）</b><Switch on={s.ports.eeeOff} onchange={v => setPort('eeeOff', v)} label="关闭节能以太网" /><small>上游网卡频繁断线、掉到 100M 时可以试试</small></div>
      </div>
      <div class="blk">
        <div class="lbl">系统</div>
        <div class="swrow"><b>指示灯</b><Switch on={s.ports.led} onchange={v => setPort('led', v)} label="路由器指示灯" /><small>晚上嫌亮可以关</small></div>
        <div class="swrow"><b>SSH 只允许内网</b><Switch on={s.ports.sshLanOnly} onchange={v => setPort('sshLanOnly', v)} label="SSH 只允许内网" /><small>只接受密钥登录 · 外网访问走 Tailscale</small></div>
        <div class="actions"><button class="btn" onclick={restartNetwork}><Icon name="sync" />重启网络</button><button class="btn" onclick={backupRouter}><Icon name="down" />备份配置</button></div>
      </div>
    </section>
  {:else}
    <section class="card pad full">
      <div class="actions" style="margin-top:0"><button class="btn" onclick={restartNetwork}><Icon name="sync" />重启网络</button><button class="btn" onclick={backupRouter}><Icon name="down" />备份配置</button></div>
      <p class="hint2"><Icon name="info" /><span>WAN 看门狗、EEE、指示灯等需要在路由器上安装 HomeNet 插件。</span></p>
    </section>
  {/if}
{/if}
