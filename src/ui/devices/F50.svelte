<script lang="ts">
  import type { BandLock } from '../../lib/types';
  import { store as s, conn } from '../../lib/store.svelte';
  import { chartPath, hm, when } from '../../lib/format';
  import { toast } from '../../lib/ui.svelte';
  import {
    USB_MODES, RATS, bandName, toggleF50Wifi, setF50Band, setF50Hidden, setUsb, setRat, toggleData, setRoaming,
    setAirplane, redial, setF50Toggle, rebootF50, applyBands, startOptimizer,
  } from '../../lib/actions';
  import Icon from '../parts/Icon.svelte';
  import Switch from '../parts/Switch.svelte';
  import Chan from '../parts/Chan.svelte';
  import ModuleError from '../parts/ModuleError.svelte';

  const st = $derived(s.ufi!);
  const w = $derived(s.ufiWifi);
  const routerSsid = $derived(s.radios[0]?.ssid);

  let pick = $state<BandLock>({ nr: [], lte: [] });
  $effect(() => { if (s.bands) pick = { nr: [...s.bands.current.nr], lte: [...s.bands.current.lte] }; });
  const cur = $derived(s.bands?.current ?? { nr: [], lte: [] });
  const sup = $derived(s.bands?.supported ?? { nr: [], lte: [] });
  const same = $derived((['nr', 'lte'] as const).every(k => [...pick[k]].sort().join() === [...cur[k]].sort().join()));
  const fmt = (k: 'nr' | 'lte') => (pick[k].length === sup[k].length ? '全部' : pick[k].join('+') || '无');
  function flip(k: 'nr' | 'lte', b: string) {
    pick[k] = pick[k].includes(b) ? pick[k].filter(x => x !== b) : [...pick[k], b];
  }
  function resetPick() { pick = { nr: [...cur.nr], lte: [...cur.lte] }; }

  const rs = $derived(s.rsrpHist.length > 1 ? chartPath(s.rsrpHist, 300, 120, 100) : '');
  const sn = $derived(s.sinrHist.length > 1 ? chartPath(s.sinrHist, 300, 120, 100) : '');
  const temps = $derived(st ? ([['主板', st.temps.board], ['SoC', st.temps.soc], ['基带', st.temps.modem], ['PA', st.temps.pa]] as [string, number][]) : []);
  const unread = $derived(s.sms.filter(m => !m.read).length);
  const usbName = $derived(USB_MODES.find(u => u.k === s.usb)?.name ?? s.usb);
  const na = conn.ufi?.limits ?? {};
  const smsTime = (t: number) => (Date.now() - t < 86_400_000 && new Date(t).getDate() === new Date().getDate() ? hm(t) : when(t, '').startsWith('昨') ? '昨天' : when(t));
</script>

{#if !st}<ModuleError module="ufi" />{/if}
{#if st}
  <section class="card hero-dev full">
    <svg viewBox="0 0 120 120"><ellipse cx="60" cy="110" rx="36" ry="6" fill="#000" opacity=".25" /><rect x="28" y="10" width="64" height="94" rx="18" fill="url(#gF)" stroke="rgba(255,255,255,.14)" /><rect x="37" y="22" width="46" height="30" rx="7" fill="#0c0e0f" /><text x="60" y="42" text-anchor="middle" font-family="Geist Mono" font-size="13" font-weight="700" fill="#d4ff3a">{st.signal.network.startsWith('4G') ? '4G' : '5G'}</text><circle cx="60" cy="74" r="8" fill="none" stroke="#d4ff3a" stroke-width="2" /><rect x="51" y="96" width="18" height="3" rx="1.5" fill="#6c7378" /></svg>
    <div>
      <div class="lbl">{st.model} · {st.signal.operator}</div>
      <h3>{st.airplane ? '飞行模式' : st.dataOn ? `${st.signal.network} 在线` : '移动数据已关闭'}</h3>
      <div class="chips2"><span class="ok">已授权 UFI</span><span>{st.signal.bands.join(' + ')}</span><span>USB · {usbName}</span>{#if w}<span>Wi-Fi {w.on ? '开' : '关'}</span>{/if}<span>运行 {Math.floor(st.uptime / 3600)}h</span></div>
    </div>
  </section>

  <section class="card pad full f50ctl">
    {#if w}
      <div class="blk">
        <div class="lbl">Wi-Fi 热点{#if routerSsid}<span class="r mono dim">家里 Wi-Fi 由路由器提供</span>{/if}</div>
        <div class="wifi-hero" class:on={w.on}>
          <span class="wic"><Icon name="wifi" /></span>
          <span><b>{w.ssid}</b><small>{w.on ? `${w.clients} 台设备 · ${bandName(w.band)}` : '已关闭 · 省电降温'}</small></span>
          <Switch on={w.on} onchange={toggleF50Wifi} label="F50 Wi-Fi" />
        </div>
        {#if w.on}
          <div>
            <Chan style="margin-top:10px" options={[['2.4', '2.4G'], ['5', '5G']]} value={w.band} onpick={setF50Band} />
            {#if na.hidden}
              <div class="swrow na"><b>隐藏名称</b><span class="sw off" class:on={w.hidden} aria-hidden="true"></span><small>暂不支持：{na.hidden}</small></div>
            {:else}
              <div class="swrow"><b>隐藏名称</b><Switch on={w.hidden} onchange={setF50Hidden} label="隐藏名称" /><small>别人搜不到，已连的设备不受影响</small></div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    <div class="blk">
      <div class="lbl">USB 网络模式<span class="r mono dim">改完 USB 重新连接</span></div>
      <div class="opts">
        {#each USB_MODES as u (u.k)}<button class="opt" class:on={s.usb === u.k} onclick={() => setUsb(u.k)}><span class="oic"><Icon name={u.ic} /></span><b>{u.name}</b><small>{u.desc}</small></button>{/each}
      </div>
      <p class="hint2"><Icon name="info" /><span>这个模式只在 F50 直插电脑或路由器时生效；F50 当主机接 OTG 网卡时不影响。Win10 没有 ECM 驱动，插电脑用 RNDIS。</span></p>
    </div>
    <div class="blk">
      <div class="lbl">网络制式</div>
      <Chan style="margin-top:10px" options={RATS} value={s.rat} onpick={setRat} />
      <div class="swrow"><b>移动数据</b><Switch on={st.dataOn} onchange={toggleData} label="移动数据" /><small>{st.signal.operator} · {st.pdp.replace('IPv4v6', 'IPv4 + IPv6')}</small></div>
      <div class="swrow"><b>数据漫游</b><Switch on={st.roaming} onchange={setRoaming} label="数据漫游" /><small>出省不用开，出境才需要</small></div>
      {#if na.airplane}
        <div class="swrow na"><b>飞行模式</b><span class="sw off" aria-hidden="true"></span><small>暂不支持：{na.airplane}</small></div>
      {:else}
        <div class="swrow"><b>飞行模式</b><Switch on={!!st.airplane} onchange={setAirplane} label="飞行模式" /><small>相当于重启基带，信号卡住时用</small></div>
      {/if}
      <div class="actions" style="margin-top:4px"><button class="btn" onclick={redial}><Icon name="sync" />重新拨号</button></div>
    </div>
    {#if s.toggles}
      <div class="blk">
        <div class="lbl">设备</div>
        <div class="swrow"><b>指示灯</b><Switch on={s.toggles.led} onchange={v => setF50Toggle('led', v)} label="指示灯" /><small>晚上嫌亮可以关</small></div>
        <div class="swrow"><b>有线 ADB</b><Switch on={s.toggles.adb} onchange={v => setF50Toggle('adb', v)} label="有线 ADB" /><small>调试用，平时关着更安全</small></div>
        {#if s.toggles.fotaBlock === undefined}
          <div class="swrow"><b>拦截系统更新</b><button class="btn sm" onclick={() => setF50Toggle('fotaBlock', true)}>拦截</button><small>读不到当前状态，可以再拦一次。{na.fotaUnblock ?? ''}</small></div>
        {:else}
          <div class="swrow"><b>拦截系统更新</b><Switch on={s.toggles.fotaBlock} onchange={v => setF50Toggle('fotaBlock', v)} label="拦截系统更新" /><small>{s.toggles.fotaBlock && na.fotaUnblock ? na.fotaUnblock : '挡住中兴 FOTA，防止固件被升级'}</small></div>
        {/if}
        <div class="actions" style="margin-top:4px"><button class="btn danger" onclick={rebootF50}><Icon name="power" />重启 F50</button></div>
      </div>
    {/if}
  </section>

  <section class="card pad full">
    <div class="lbl">信号趋势<span class="r"><span class="seg-mini"><button class="on">实时</button><button onclick={() => toast('24 小时趋势要等插件记录（M3）')}>24 小时</button></span></span></div>
    <svg class="chart" viewBox="0 0 300 120" preserveAspectRatio="none">
      <path d="M0 30H300M0 60H300M0 90H300" stroke="var(--line)" fill="none" />
      <path d={rs} stroke="var(--lime)" stroke-width="2" fill="none" vector-effect="non-scaling-stroke" />
      <path d={sn} stroke="var(--sky)" stroke-width="2" fill="none" vector-effect="non-scaling-stroke" opacity=".85" />
    </svg>
    <div class="legend"><span><i style="background:var(--lime)"></i>RSRP −{Math.abs(st.signal.rsrp)} dBm</span><span><i style="background:var(--sky)"></i>SINR {st.signal.sinr} dB</span><span>PCI {st.signal.pci}</span></div>
  </section>

  {#if s.bands}
    <section class="card pad">
      <div class="lbl">锁定频段<span class="r mono dim">绿点 = 当前</span></div>
      <div class="bands">
        {#each [['nr', 'NR'], ['lte', 'LTE']] as [k, n] (k)}
          {@const kk = k as 'nr' | 'lte'}
          <span class="lb">{n}</span>
          <div class="bchips">{#each sup[kk] as b (b)}<button class="bchip" class:on={pick[kk].includes(b)} class:cur={cur[kk].includes(b)} onclick={() => flip(kk, b)}>{b}</button>{/each}</div>
        {/each}
      </div>
      <div class="optim"><span class="ic"><Icon name="spark" /></span><span><b>智能寻优</b><small>逐个频段测速，选最快组合 · 约 3 分钟</small></span><button class="btn sm pri" onclick={startOptimizer}>开始</button></div>
      <div class="diff">{#if same}与当前一致{:else}将改为 <b>NR {fmt('nr')}</b> · <b>LTE {fmt('lte')}</b>{/if}</div>
      <div class="actions"><button class="btn" onclick={resetPick}>恢复当前</button><button class="btn ink" disabled={same || (!pick.nr.length && !pick.lte.length)} onclick={() => applyBands(pick)}>应用锁频</button></div>
    </section>
  {/if}

  <section class="card pad">
    <div class="lbl">温度 ℃<span class="r mono dim">{st.temps.throttleAt}° 起限速</span></div>
    <div class="temps">
      {#each temps as [n, v] (n)}
        <div><svg viewBox="0 0 64 44"><path d="M6 40a26 26 0 0 1 52 0" fill="none" stroke="var(--s3)" stroke-width="6" stroke-linecap="round" /><path d="M6 40a26 26 0 0 1 52 0" fill="none" stroke={v >= st.temps.throttleAt - 5 ? 'var(--amber)' : 'var(--mint)'} stroke-width="6" stroke-linecap="round" stroke-dasharray="81.7" stroke-dashoffset={81.7 * (1 - v / 100)} /><text x="32" y="40" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="15" fill="var(--ink)">{v}</text></svg><small>{n}</small></div>
      {/each}
    </div>
    <div class="lbl" style="margin-top:18px">短信<span class="r mono dim">{unread ? `${unread} 条未读` : '全部已读'}</span></div>
    <ul class="sms">
      {#each s.sms as m (m.id)}
        <li class:unread={!m.read}><span class="av">{m.from.slice(0, 5)}</span><b>{m.from === '10086' ? '中国移动' : m.from.length <= 4 ? '验证码' : m.from}</b><time>{smsTime(m.time)}</time><p>{m.text}</p></li>
      {/each}
    </ul>
  </section>
{/if}
