<script lang="ts">
  import { onMount } from 'svelte';
  import { store as s, conn, keyLine, serviceName, settings, keyLineMember, connKind, deviceName, refreshProxyPage, refreshConns, refreshTop } from '../../lib/store.svelte';
  import { poll } from '../../lib/poll';
  import { setMode, selectNode, testGroup, verifyKeyLine, updateAllSubs, updateSub, closeAllConns, closeConn, removeRule, routeDomain, toggleNikki } from '../../lib/actions';
  import { probe, type ProbeResult } from '../../lib/rules';
  import { ago, gb, latClass, latText, rateText, ymd } from '../../lib/format';
  import Icon from '../parts/Icon.svelte';
  import Ring from '../parts/Ring.svelte';
  import ModuleError from '../parts/ModuleError.svelte';
  import { editCurrentProfile } from '../../lib/profile-actions';

  onMount(() => {
    refreshProxyPage();
    return poll(refreshConns, false);
  });

  const MODES: ['rule' | 'global' | 'direct', string][] = [['rule', '规则'], ['global', '全局'], ['direct', '直连']];
  const PALETTE = ['#8b5cf6', '#10a36a', '#0e7c55', '#1c8fd6', '#ff3d3d', '#fb7299', '#d97757', '#555', '#4285f4'];
  const colorOf = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const label = (t: string) => (t === 'DIRECT' ? '直连' : t);

  /* ── 重点线路链：重点线路分组当前选中的 fallback 分组 ── */
  const member = $derived(s.proxies ? keyLineMember() : undefined);
  const exit = $derived(member ? s.exits[member] : undefined);
  const mismatch = $derived(!!exit && !!keyLine.expectIp && exit.ip !== keyLine.expectIp);
  const chainGroup = $derived.by(() => {
    const g = s.proxies?.groups;
    if (!g) return undefined;
    const kl = g.find(x => x.name === keyLine.group);
    if (kl?.type === 'Fallback') return kl;
    return g.find(x => x.name === kl?.now && x.type === 'Fallback');
  });
  let checking = $state(false);
  async function verify() { checking = true; await verifyKeyLine(); checking = false; }

  /* ── 分组 ── */
  const groups = $derived(s.proxies?.groups.filter(g => !g.hidden) ?? []);
  let gi = $state(0);
  const g = $derived(groups[Math.min(gi, groups.length - 1)]);
  const isAuto = $derived(g ? g.type !== 'Selector' : false);
  let testing = $state(false);
  async function test() { if (!g) return; testing = true; await testGroup(g.name); testing = false; }
  function flag(name: string): string {
    const n = s.proxies?.nodes[name];
    if (s.proxies?.groups.some(x => x.name === name)) return '→';
    return n?.region ?? '—';
  }

  /* ── 这个网址走哪里 ── */
  let q = $state('');
  let res = $state.raw<ProbeResult | null>(null);
  function run(v = q) { if (s.proxies) res = probe(v, s.rules, s.myRules, s.proxies); }
  const QUICK = ['claude.ai', 'chatgpt.com', 'github.com', 'bilibili.com'];
  const exitText = (r: ProbeResult) => {
    if (r.path.at(-1) === 'DIRECT') return '本地出口';
    for (const p of r.path) if (s.exits[p]) return `${s.exits[p].ip} · ${s.exits[p].region ?? ''}`;
    return '出口未核对';
  };
  const ruleText = (r: ProbeResult) =>
    `命中 ${r.rule} · 出口 ${exitText(r)}${r.guessed ? '（按分类名推测，装插件后可实测）' : ''}${r.skipped ? ` · 跳过 ${r.skipped} 条 App 无法判断的规则` : ''}`;
  const targets = $derived.by(() => {
    const set = new Set<string>([keyLine.group]);
    for (const r of s.rules) if (r.proxy !== 'REJECT') set.add(r.proxy);
    set.add('DIRECT');
    return [...set].filter(t => t !== res?.target).slice(0, 4);
  });
  async function change(t: string) {
    if (!res) return;
    const wasKey = res.path.includes(keyLine.group);
    if (await routeDomain(res.domain, t, label(t), wasKey)) run(res.domain);
  }

  /* ── 订阅 ── */
  let subBusy = $state<Record<string, boolean>>({});
  async function upd(name: string) { subBusy[name] = true; await updateSub(name); subBusy[name] = false; }
  async function updAll() { for (const p of s.providers) subBusy[p.name] = true; await updateAllSubs(); subBusy = {}; }

  /* ── 实时连接 ── */
  let cf = $state<'all' | 'key' | 'proxy' | 'direct'>('all');
  const conns = $derived(s.conns?.connections ?? []);
  const counts = $derived.by(() => {
    const c = { all: conns.length, key: 0, proxy: 0, direct: 0 };
    for (const x of conns) c[connKind(x)]++;
    return c;
  });
  const shown = $derived(cf === 'all' ? conns : conns.filter(c => connKind(c) === cf));
  const LIMIT = 100;
  const DOT = { key: 'var(--lime)', proxy: 'var(--sky)', direct: 'var(--ink-3)' };
  const chainText = (ch: string[]) => (ch.length > 1 ? `${ch.at(-1)} → ${ch[0]}` : ch[0]);

  /* ── 流量排行 ── */
  let topBy = $state<'domain' | 'device'>('domain');
  const topMax = $derived(Math.max(1, ...s.top.map(t => t.bytes)));

  const kind = conn.profile.mihomo?.kind ?? 'mihomo';
  const memMB = $derived(Math.round((s.conns?.memory ?? 0) / 1048576));
</script>

<main class="page">
  {#if !conn.mihomo}
    <section class="card pad full">
      <div class="lbl">代理</div>
      <p class="hint2"><Icon name="info" /><span>这套配置没有填 mihomo（nikki / OpenClash）。填上后这里能切模式、切节点、看实时连接。</span></p>
      <div class="actions"><button class="btn pri" onclick={editCurrentProfile}>修改配置</button></div>
    </section>
  {:else}
  {#if !s.proxies}<ModuleError module="mihomo" />{:else}
  <div class="modes full">
    {#each MODES as [m, n] (m)}<button class:on={s.mode === m} onclick={() => setMode(m, n)}>{n}</button>{/each}
  </div>

  {#if s.proxies?.groups.some(x => x.name === keyLine.group)}
    <section class="card pad full chain-card">
      <div class="lbl">{keyLine.name}{#if exit}{#if mismatch}<span class="r mono warn">出口和期望不一致 · {ago(exit.checkedAt)}</span>{:else}<span class="r verified">出口已核对 · {ago(exit.checkedAt)}</span>{/if}{/if}</div>
      <div class="chain-top">
        <div>
          <div class="ip disp">{exit?.ip ?? '未核对'}</div>
          <div class="geo">{#if exit}{exit.region} {exit.city} · {exit.isp}{#if exit.residential}<em class="tag">住宅 IP</em>{/if}{:else}经 {member}{/if}</div>
        </div>
        <button class="btn sm" onclick={verify} disabled={checking}>{checking ? '核对中…' : '核对出口'}</button>
      </div>
      {#if chainGroup}
        <ul class="chain">
          {#each chainGroup.all as n, i (n)}
            {@const node = s.proxies.nodes[n]}
            {@const down = !node?.alive}
            {@const on = n === chainGroup.now}
            <li class:on class:down>
              <span class="st">{down ? '×' : i + 1}</span><b>{n}</b>
              <span class="lt {down ? 'bad' : latClass(node.delay)}">{down ? '不可用' : on ? `使用中 · ${node.delay}ms` : latText(node.delay)}</span>
              <small>{node?.type ?? ''}{node?.udp ? ' · UDP' : ''}{i ? ` · 第 ${i + 1} 备用` : ''}</small>
            </li>
          {/each}
        </ul>
        <p class="hint2"><Icon name="info" /><span>{chainGroup.name} 是 fallback 分组：自上而下用第一个可用的节点，前面的恢复后自动切回。</span></p>
      {/if}
    </section>
  {/if}

  <div class="gchips full">
    {#each groups as x, i (x.name)}<button class="gchip" class:on={x === g} onclick={() => (gi = i)}>{x.name}<small>{x.all.length}</small></button>{/each}
  </div>
  {#if g}
    <section class="card full">
      <div class="ghead">
        <div class="t"><b>{g.name}</b><small>{g.type.toLowerCase()} · 当前 {g.now}</small></div>
        {#if isAuto}<span class="auto-tag">内核自动选</span>{/if}
        <button class="btn sm" class:busy={testing} onclick={test}><Icon name="gauge" />测速</button>
      </div>
      <div class="nodes">
        {#each g.all as n (n)}
          {@const d = s.proxies?.nodes[n]?.delay ?? null}
          <button class="nd" class:on={n === g.now} class:auto={isAuto} onclick={() => !isAuto && n !== g.now && selectNode(g.name, n)}>
            <span class="top"><span class="flag">{flag(n)}</span><span class="nm">{n}</span></span>
            <span class="lat {latClass(d)}" style="--w:{d == null ? 0 : Math.max(8, 100 - d / 4)}%"><i></i>{latText(d)}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section class="card pad">
    <div class="lbl">这个网址走哪里</div>
    <form class="probe" onsubmit={e => { e.preventDefault(); run(); }}>
      <input bind:value={q} placeholder="输入域名或网址，如 openai.com" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" />
      <button class="btn pri" type="submit">查询</button>
    </form>
    <div class="chips2 quick">{#each QUICK as d (d)}<button onclick={() => { q = d; run(d); }}>{d}</button>{/each}</div>
    {#if res}
      {#key res}
        <div class="pres">
          <div class="flow"><span>{res.domain}</span>{#each res.path as p, i (i)}<i>→</i><span class:hl={i === res.path.length - 1}>{label(p)}</span>{/each}</div>
          <div class="rule">{ruleText(res)}</div>
          {#if conn.plugin && s.has('my-rules')}
            <div class="chg"><small>想让它改走：</small><div class="chips2">{#each targets as t (t)}<button onclick={() => change(t)}>{label(t)}</button>{/each}</div></div>
          {/if}
        </div>
      {/key}
    {/if}
  </section>

  <section class="card">
    <div class="ghead"><div class="t"><b>订阅</b><small>{s.providers.length} 个 · 由内核按配置定时更新</small></div><button class="btn sm" onclick={updAll}>全部更新</button></div>
    <ul class="subs">
      {#each s.providers as p (p.name)}
        {@const sub = p.subscription}
        <li class:busy={subBusy[p.name]}>
          <span class="sic" style="background:{colorOf(p.name)}">{p.name[0].toUpperCase()}</span>
          <b>{p.name}</b>
          <button class="btn sm up" aria-label="更新 {p.name}" onclick={() => upd(p.name)}><Icon name="sync" /></button>
          <span class="meta">{p.nodeCount} 节点 · {ago(p.updatedAt)}更新</span>
          {#if sub}
            <span class="bar"><i style="width:{((sub.upload + sub.download) / sub.total) * 100}%"></i></span>
            <span class="meta">{gb(sub.upload + sub.download, 0)}/{gb(sub.total, 0)} GB · {sub.expire ? ymd(sub.expire) + ' 到期' : '不限期'}</span>
          {:else}
            <span class="meta">{p.vehicleType === 'HTTP' ? '没有返回流量信息' : '本地文件'}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="card full">
    <div class="ghead"><div class="t"><b>实时连接</b><small>{conns.length} 条 · 每 {settings.refresh} 秒刷新</small></div><button class="btn sm danger" onclick={closeAllConns}>全部断开</button></div>
    <div class="cfilter">
      {#each [['all', '全部'], ['key', keyLine.name], ['proxy', '代理'], ['direct', '直连']] as [k, n] (k)}
        <button class:on={cf === k} onclick={() => (cf = k as typeof cf)}>{n}<small>{counts[k as keyof typeof counts]}</small></button>
      {/each}
    </div>
    <ul class="conns">
      {#each shown.slice(0, LIMIT) as c (c.id)}
        <li>
          <span class="dot" style="background:{DOT[connKind(c)]}"></span>
          <span class="h">{c.host || c.destination}</span>
          <span class="sp">{rateText(c.rate.down)}</span>
          <button class="x" aria-label="断开" onclick={() => closeConn(c.id, c.host || c.destination)}><Icon name="x" /></button>
          <span class="m"><b>{deviceName(c.sourceIp)}</b> · {chainText(c.chains)} · {c.rule}{c.rulePayload ? ',' + c.rulePayload : ''}</span>
        </li>
      {:else}
        <li class="dim" style="grid-template-columns:1fr">没有连接</li>
      {/each}
      {#if shown.length > LIMIT}<li class="more-note">只显示前 {LIMIT} 条，共 {shown.length} 条</li>{/if}
    </ul>
  </section>

  {#if conn.plugin && s.has('my-rules')}
    <section class="card">
      <div class="ghead"><div class="t"><b>我的规则</b><small>排在订阅规则前面，优先生效</small></div></div>
      <ul class="myrules">
        {#each s.myRules as r (r.domain)}
          <li><span class="d">{r.domain}<small>DOMAIN-SUFFIX · {ymd(r.addedAt).slice(5)} 添加</small></span><span class="g">{label(r.target)}</span><button class="x" aria-label="删除" onclick={() => removeRule(r.domain)}><Icon name="x" /></button></li>
        {:else}
          <li class="empty">还没有。在「这个网址走哪里」查完后可以一键添加。</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if conn.plugin && s.has('traffic-top')}
    <section class="card">
      <div class="ghead"><div class="t"><b>流量排行</b><small>今天 · 按{topBy === 'domain' ? '域名' : '设备'}</small></div>
        <span class="seg-mini"><button class:on={topBy === 'domain'} onclick={() => { topBy = 'domain'; refreshTop('domain'); }}>域名</button><button class:on={topBy === 'device'} onclick={() => { topBy = 'device'; refreshTop('device'); }}>设备</button></span>
      </div>
      <ul class="toplist">
        {#each s.top as t (t.name)}
          {@const c = colorOf(t.name)}
          <li><span class="fav" style="background:{c}">{t.name[0].toUpperCase()}</span><span class="d">{t.name}</span><span class="v">{gb(t.bytes, 2)} GB</span><span class="bar"><i style="width:{(t.bytes / topMax) * 100}%;background:{c}"></i></span><span class="g">{t.via}</span></li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card pad">
    <div class="lbl">{kind} 内核<span class="r {s.nikkiRunning ? 'verified' : 'mono bad'}">{s.nikkiRunning ? `运行中 · ${s.mihomoVersion}` : '已停止'}</span></div>
    <div class="rings3">
      <Ring pct={s.status?.cpu ?? 0} color="var(--lime)" text="{s.status?.cpu ?? 0}%" label="路由器 CPU" />
      <Ring pct={memMB / 2.56} color="var(--sky)" text="{memMB}M" label="内存" size={15} />
      <Ring pct={Math.min(100, conns.length)} color="var(--amber)" text={String(conns.length)} label="连接" />
    </div>
    <div class="actions"><button class="btn" onclick={closeAllConns}>断开全部连接</button><button class="btn" onclick={updAll}>更新订阅</button></div>
    {#if serviceName()}<div class="actions" style="margin-top:8px"><button class="btn" class:danger={s.nikkiRunning} onclick={toggleNikki}>{s.nikkiRunning ? `停止 ${kind}` : `启动 ${kind}`}</button></div>{/if}
  </section>
  {/if}
  {/if}
</main>
