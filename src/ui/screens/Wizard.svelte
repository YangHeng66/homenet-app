<script lang="ts">
  import { onMount } from 'svelte';
  import type { MihomoConnector, OpenWrtRpcConnector, Profile, ProxyGroup } from '../../lib/types';
  import type { SharedProfile } from '../../lib/share';
  import { createConnectors, addressScope } from '../../lib/connectors';
  import { describeError, type ModuleKey } from '../../lib/session';
  import { profiles } from '../../lib/store.svelte';
  import { ask, closeScreen, onScreenBack, openScreen, toast } from '../../lib/ui.svelte';
  import { enterDemo, saveAndUse } from '../../lib/profile-actions';
  import { buildProfile, DEFAULT_PORT, formFrom, hasModule, publicUrls } from '../../lib/wizard';
  import { normalizeUrl } from '../../lib/validate';
  import Icon from '../parts/Icon.svelte';
  import Switch from '../parts/Switch.svelte';
  import Chan from '../parts/Chan.svelte';

  let { base, prefill, first = false }: { base?: Profile; prefill?: SharedProfile; first?: boolean } = $props();

  type Step = 'start' | 'router' | 'mihomo' | 'ufi' | 'keyline' | 'done';
  type Test = { state: 'idle' | 'busy' | 'ok' | 'err'; title?: string; hint?: string };
  const IDLE: Test = { state: 'idle' };

  // svelte-ignore state_referenced_locally
  let f = $state(formFrom(base ?? prefill));
  // svelte-ignore state_referenced_locally
  let step = $state<Step>(first && !base && !prefill ? 'start' : 'router');
  let tests = $state<Record<ModuleKey, Test>>({ router: IDLE, mihomo: IDLE, ufi: IDLE });
  let detect = $state<'idle' | 'busy' | 'found' | 'none' | 'err'>('idle');
  let groups = $state.raw<ProxyGroup[]>([]);
  let showPw = $state(false);
  let saving = $state(false);
  let routerConn = $state.raw<OpenWrtRpcConnector>();
  let mihomoConn = $state.raw<MihomoConnector>();

  const title = $derived(base ? '修改配置' : prefill ? '导入配置' : '添加设备');
  const steps = $derived<Step[]>(['router', 'mihomo', 'ufi', ...(f.mihomo.on ? ['keyline' as const] : []), 'done']);
  const idx = $derived(steps.indexOf(step));

  function go(to: Step) {
    step = to;
    scrollTo({ top: 0 });
    if (to === 'mihomo' && detect === 'idle' && routerConn && !f.mihomo.url) detectMihomo();
    if (to === 'keyline' && !groups.length) loadGroups();
  }
  const next = () => go(steps[idx + 1]);
  function back(): boolean {
    if (step === 'start') return false;
    if (idx <= 0) { if (base || prefill || !first) return false; step = 'start'; return true; }
    go(steps[idx - 1]);
    return true;
  }
  onMount(() => { onScreenBack(back); return () => onScreenBack(null); });

  function tmpProfile(m: ModuleKey): Profile {
    const p = buildProfile({ ...f, router: { ...f.router, on: m === 'router' }, mihomo: { ...f.mihomo, on: m === 'mihomo' }, ufi: { ...f.ufi, on: m === 'ufi' }, keyLine: { ...f.keyLine, on: false } }, 'wizard');
    return p;
  }

  async function confirmPublic(u: string): Promise<boolean> {
    if (addressScope(u) !== 'public' || f.allowPublic) return true;
    const ok = await ask({
      title: '这是公网地址', what: new URL(u).host, icon: 'globe',
      impact: [
        ['x', u.startsWith('http:') ? '连接是明文 HTTP，经过的网络都能看到密码和 secret' : '设备暴露在公网上，任何人都能尝试登录'],
        ['w', '建议改用 Tailscale 地址（100.x.x.x），或者只在家里 Wi-Fi 下使用'],
        ['i', '确认后，这套配置里的公网地址都会放行'],
      ],
    });
    if (ok) f.allowPublic = true;
    return ok;
  }

  /** 连一次，成功返回连接器；失败把原因写进 tests */
  async function probe<T>(m: ModuleKey, run: (c: ReturnType<typeof createConnectors>) => Promise<T>): Promise<T | undefined> {
    let p: Profile;
    try { p = tmpProfile(m); } catch (e) { tests[m] = { state: 'err', title: (e as Error).message, hint: '例如 192.168.1.1 或 http://192.168.1.1:9090' }; return; }
    const u = p[m]!.url;
    if (addressScope(u) === 'invalid') { tests[m] = { state: 'err', title: '地址不对', hint: u }; return; }
    if (!(await confirmPublic(u))) { tests[m] = { state: 'err', title: '没有放行公网地址', hint: '换成局域网或 Tailscale 地址再试' }; return; }
    tests[m] = { state: 'busy' };
    try {
      const r = await run(createConnectors(p, { allowPublic: f.allowPublic }));
      return r;
    } catch (e) {
      const d = describeError(e, m);
      tests[m] = { state: 'err', title: d.title, hint: d.hint };
    }
  }

  async function testRouter() {
    const r = await probe('router', async c => ({ c: c.router!, b: await c.router!.board() }));
    if (!r) return;
    routerConn = r.c;
    detect = 'idle';
    tests.router = { state: 'ok', title: `已连上 ${r.b.model}`, hint: `${r.b.release} · ${r.b.hostname}` };
    if (!f.name.trim()) f.name = r.b.hostname || '家';
  }

  async function detectMihomo() {
    if (!routerConn) return;
    detect = 'busy';
    try {
      const m = await routerConn.detectMihomo();
      if (!m) { detect = 'none'; f.mihomo.on = !!f.mihomo.url; return; }
      f.mihomo = { on: true, url: m.url, secret: m.secret ?? '', kind: m.kind };
      detect = 'found';
      await testMihomo();
    } catch (e) {
      detect = 'err';
      tests.mihomo = { state: 'err', ...pick(describeError(e, 'router')) };
    }
  }
  const pick = (d: { title: string; hint: string }) => ({ title: d.title, hint: d.hint });

  async function testMihomo() {
    const r = await probe('mihomo', async c => ({ c: c.mihomo!, v: await c.mihomo!.version() }));
    if (!r) return;
    mihomoConn = r.c;
    groups = [];
    tests.mihomo = { state: 'ok', title: `已连上 ${f.mihomo.kind}`, hint: `mihomo ${r.v.version}${r.v.meta ? ' · Meta' : ''}` };
  }

  async function testUfi() {
    const st = await probe('ufi', c => c.ufi!.status());
    if (!st) return;
    tests.ufi = { state: 'ok', title: `已连上 ${st.model || 'F50'}`, hint: `${st.signal.network || '无信号'} · UFI-TOOLS ${st.ufiVersion}` };
  }

  async function loadGroups() {
    if (!mihomoConn) return;
    try {
      const snap = await mihomoConn.getProxies();
      groups = snap.groups.filter(g => !g.hidden && g.type !== 'LoadBalance' && g.type !== 'Relay');
    } catch { groups = []; }
  }

  // 改了地址或密码，之前的测试结果就不算数了
  function dirty(m: ModuleKey) {
    if (tests[m].state !== 'idle') tests[m] = IDLE;
    if (m === 'router') { routerConn = undefined; detect = 'idle'; }
    if (m === 'mihomo') mihomoConn = undefined;
  }

  async function save() {
    let p: Profile;
    try { p = buildProfile(f, base?.id ?? profiles.newId()); } catch (e) { toast((e as Error).message); return; }
    for (const u of publicUrls(f)) if (!(await confirmPublic(u))) return;
    p.allowPublic = f.allowPublic && publicUrls(f).length > 0;
    saving = true;
    try { await saveAndUse(p); } catch (e) { toast(`保存失败：${(e as Error).message}`); } finally { saving = false; }
  }

  const portHint = (m: 'mihomo' | 'ufi') => `只填 IP 时默认端口 ${DEFAULT_PORT[m]}`;
  const scopeOf = (raw: string, port?: number) => { const u = normalizeUrl(raw, port); return u ? addressScope(u) : 'invalid'; };
  const NAMES: Record<Step, string> = { start: '', router: '路由器', mihomo: '代理', ufi: 'F50', keyline: '重点线路', done: '保存' };
  const summary = $derived([
    f.router.on && f.router.url && { m: 'router' as const, n: '路由器', v: normalizeUrl(f.router.url) ?? f.router.url },
    f.mihomo.on && f.mihomo.url && { m: 'mihomo' as const, n: f.mihomo.kind, v: normalizeUrl(f.mihomo.url, DEFAULT_PORT.mihomo) ?? f.mihomo.url },
    f.ufi.on && f.ufi.url && { m: 'ufi' as const, n: 'F50', v: normalizeUrl(f.ufi.url, DEFAULT_PORT.ufi) ?? f.ufi.url },
  ].filter(Boolean) as { m: ModuleKey; n: string; v: string }[]);
</script>

{#snippet result(t: Test)}
  {#if t.state !== 'idle'}
    <div class="res {t.state}" role="status">
      <i>{t.state === 'busy' ? '' : t.state === 'ok' ? '✓' : '!'}</i>
      <span><b>{t.state === 'busy' ? '正在连接…' : t.title}</b>{#if t.hint && t.state !== 'busy'}<small>{t.hint}</small>{/if}</span>
    </div>
  {/if}
{/snippet}

{#snippet scopeNote(raw: string, port?: number)}
  {#if raw.trim() && scopeOf(raw, port) === 'public'}
    <p class="hint2 warnline"><Icon name="globe" /><span>公网地址：明文 HTTP，密码会被看到。连接前会再问你一次。</span></p>
  {:else if raw.trim() && scopeOf(raw, port) === 'invalid'}
    <p class="hint2 warnline"><Icon name="warn" /><span>地址格式不对，例如 192.168.1.1</span></p>
  {/if}
{/snippet}

<main class="page wiz">
  {#if step === 'start'}
    <section class="card hero">
      <div class="logo"><Icon name="router" /></div>
      <h1>HomeNet</h1>
      <p>控制家里的 OpenWrt 路由器、mihomo 代理（nikki / OpenClash）和随身 WiFi。</p>
      <div class="starts">
        <button class="btn pri big" onclick={() => go('router')}><Icon name="router" />连接我的设备</button>
        <button class="btn big" onclick={() => openScreen({ kind: 'import' })}><Icon name="down" />扫码或粘贴导入配置</button>
        <button class="btn big" onclick={enterDemo}><Icon name="spark" />先看看演示</button>
      </div>
      <p class="foot mono">数据只在设备和这台手机之间传，不经过任何外部服务器</p>
    </section>
  {:else}
    <header class="whead">
      <button class="icon-btn" aria-label={idx === 0 && (base || prefill || !first) ? '关闭' : '上一步'} onclick={() => back() || closeScreen()}><Icon name={idx === 0 && (base || prefill || !first) ? 'x' : 'back'} /></button>
      <div><small class="mono">{title} · {idx + 1}/{steps.length}</small><h2>{NAMES[step]}</h2></div>
    </header>
    <div class="dots" aria-hidden="true">{#each steps as st, i (st)}<i class:on={i <= idx}></i>{/each}</div>

    {#if step === 'router'}
      <section class="card pad">
        <div class="lbl">OpenWrt 路由器<span class="r"><Switch on={f.router.on} onchange={v => { f.router.on = v; dirty('router'); }} label="使用路由器" /></span></div>
        {#if f.router.on}
          <p class="intro">用 LuCI 的账号登录 rpcd（系统自带，不用装东西）。登录后会自动找 nikki / OpenClash。</p>
          <label class="fld"><span>地址</span><input bind:value={f.router.url} oninput={() => dirty('router')} placeholder="192.168.1.1" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          {@render scopeNote(f.router.url)}
          <label class="fld"><span>账号</span><input bind:value={f.router.username} oninput={() => dirty('router')} placeholder="root" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          <label class="fld pw"><span>密码</span><input type={showPw ? 'text' : 'password'} bind:value={f.router.password} oninput={() => dirty('router')} placeholder="LuCI 登录密码" autocomplete="off" /><button type="button" class="eye" onclick={() => (showPw = !showPw)}>{showPw ? '隐藏' : '显示'}</button></label>
          {@render result(tests.router)}
          <div class="actions">
            <button class="btn" disabled={!f.router.url.trim() || tests.router.state === 'busy'} onclick={testRouter}>{tests.router.state === 'ok' ? '重新连接' : '连接'}</button>
            <button class="btn pri" disabled={tests.router.state === 'busy'} onclick={next}>{tests.router.state === 'ok' ? '下一步' : '先不连，下一步'}</button>
          </div>
        {:else}
          <p class="intro">不用路由器也行：下一步手动填 mihomo 的地址，或者只用 F50。</p>
          <div class="actions"><button class="btn pri" onclick={next}>下一步</button></div>
        {/if}
      </section>
    {:else if step === 'mihomo'}
      <section class="card pad">
        <div class="lbl">mihomo 代理<span class="r"><Switch on={f.mihomo.on} onchange={v => { f.mihomo.on = v; dirty('mihomo'); }} label="使用代理" /></span></div>
        {#if detect === 'busy'}
          <div class="res busy"><i></i><span><b>正在路由器上找 nikki / OpenClash…</b></span></div>
        {:else if detect === 'found'}
          <p class="intro">在路由器上找到了 <b>{f.mihomo.kind}</b>，地址和 secret 已自动填好。</p>
        {:else if detect === 'none'}
          <p class="intro">路由器上没找到 nikki 或 OpenClash。用别的方式跑的 mihomo，可以手动填外部控制地址。</p>
        {:else if !routerConn}
          <p class="intro">填 mihomo 的外部控制（external-controller）地址和 secret。连上路由器后可以自动检测。</p>
        {/if}
        {#if f.mihomo.on}
          <Chan style="margin:12px 0 4px" options={[['nikki', 'nikki'], ['openclash', 'OpenClash'], ['mihomo', '其他']]} value={f.mihomo.kind} onpick={k => { f.mihomo.kind = k; }} />
          <label class="fld"><span>地址</span><input bind:value={f.mihomo.url} oninput={() => dirty('mihomo')} placeholder="192.168.1.1:9090" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          <small class="sub mono">{portHint('mihomo')}</small>
          {@render scopeNote(f.mihomo.url, DEFAULT_PORT.mihomo)}
          <label class="fld pw"><span>secret</span><input type={showPw ? 'text' : 'password'} bind:value={f.mihomo.secret} oninput={() => dirty('mihomo')} placeholder="没设可以留空" autocomplete="off" /><button type="button" class="eye" onclick={() => (showPw = !showPw)}>{showPw ? '隐藏' : '显示'}</button></label>
          {@render result(tests.mihomo)}
          <div class="actions">
            {#if routerConn && detect !== 'busy'}<button class="btn" onclick={detectMihomo}>重新检测</button>{/if}
            <button class="btn" disabled={!f.mihomo.url.trim() || tests.mihomo.state === 'busy'} onclick={testMihomo}>测试</button>
            <button class="btn pri" disabled={tests.mihomo.state === 'busy' || detect === 'busy'} onclick={next}>下一步</button>
          </div>
        {:else}
          <div class="actions">
            {#if routerConn && detect !== 'busy'}<button class="btn" onclick={detectMihomo}>自动检测</button>{/if}
            <button class="btn pri" onclick={next}>跳过</button>
          </div>
        {/if}
      </section>
    {:else if step === 'ufi'}
      <section class="card pad">
        <div class="lbl">随身 WiFi（可选）<span class="r"><Switch on={f.ufi.on} onchange={v => { f.ufi.on = v; dirty('ufi'); }} label="使用 F50" /></span></div>
        <p class="intro">中兴 F50 等装了 UFI-TOOLS 的随身 WiFi：看信号、温度、流量，锁频、切制式。</p>
        {#if f.ufi.on}
          <label class="fld"><span>地址</span><input bind:value={f.ufi.url} oninput={() => dirty('ufi')} placeholder="192.168.0.1:2333" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          <small class="sub mono">{portHint('ufi')}</small>
          {@render scopeNote(f.ufi.url, DEFAULT_PORT.ufi)}
          <label class="fld pw"><span>口令</span><input type={showPw ? 'text' : 'password'} bind:value={f.ufi.password} oninput={() => dirty('ufi')} placeholder="UFI-TOOLS 登录口令" autocomplete="off" /><button type="button" class="eye" onclick={() => (showPw = !showPw)}>{showPw ? '隐藏' : '显示'}</button></label>
          {@render result(tests.ufi)}
          <p class="hint2"><Icon name="info" /><span>飞行模式、隐藏 Wi-Fi 名称、测速的接口还没抓到，连上后这几项会显示为暂不支持。</span></p>
          <div class="actions">
            <button class="btn" disabled={!f.ufi.url.trim() || tests.ufi.state === 'busy'} onclick={testUfi}>测试</button>
            <button class="btn pri" disabled={tests.ufi.state === 'busy'} onclick={next}>下一步</button>
          </div>
        {:else}
          <div class="actions"><button class="btn pri" onclick={next}>没有，跳过</button></div>
        {/if}
      </section>
    {:else if step === 'keyline'}
      <section class="card pad">
        <div class="lbl">重点线路（可选）<span class="r"><Switch on={f.keyLine.on} onchange={v => (f.keyLine.on = v)} label="设置重点线路" /></span></div>
        <p class="intro">挑一个最在意的分组（比如 AI 专线），首页会单独显示它走哪个节点、出口 IP 对不对。</p>
        {#if f.keyLine.on}
          <div class="lbl" style="margin-top:12px">分组</div>
          {#if groups.length}
            <div class="gpick">{#each groups as g (g.name)}<button class:on={f.keyLine.group === g.name} onclick={() => (f.keyLine.group = g.name)}><b>{g.name}</b><small>{g.type} · {g.now}</small></button>{/each}</div>
          {:else}
            <label class="fld"><span>分组名</span><input bind:value={f.keyLine.group} placeholder="和 mihomo 配置里的分组名一样" autocomplete="off" spellcheck="false" /></label>
            <small class="sub mono">{mihomoConn ? '读不到分组列表，手动填' : '上一步测试通过后可以直接选'}</small>
          {/if}
          <label class="fld"><span>显示名</span><input bind:value={f.keyLine.name} placeholder={f.keyLine.group || 'AI 专线'} autocomplete="off" /></label>
          <label class="fld"><span>期望出口</span><input bind:value={f.keyLine.expectIp} placeholder="例如 203.0.113.24，留空只看能不能用" inputmode="decimal" autocomplete="off" spellcheck="false" /></label>
          <label class="fld"><span>核对地址</span><input bind:value={f.keyLine.checkUrl} placeholder="返回出口 IP 的网址" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          <label class="fld"><span>域名</span><input bind:value={f.keyLine.domains} placeholder="claude.ai, anthropic.com" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          <p class="hint2"><Icon name="info" /><span>核对出口要手机连着家里的网络，并且规则把核对地址分到这个分组；在外面用 Tailscale 时结果可能不准。</span></p>
        {/if}
        <div class="actions"><button class="btn pri" disabled={f.keyLine.on && !f.keyLine.group} onclick={next}>{f.keyLine.on ? '下一步' : '跳过'}</button></div>
      </section>
    {:else}
      <section class="card pad">
        <div class="lbl">保存</div>
        <label class="fld"><span>配置名</span><input bind:value={f.name} placeholder="家、公司…" autocomplete="off" /></label>
        <ul class="sum">
          {#each summary as it (it.m)}
            <li><i class={tests[it.m].state === 'ok' ? 'ok' : tests[it.m].state === 'err' ? 'bad' : ''}>{tests[it.m].state === 'ok' ? '✓' : tests[it.m].state === 'err' ? '!' : '·'}</i><b>{it.n}</b><small class="mono">{it.v}{tests[it.m].state === 'ok' ? '' : tests[it.m].state === 'err' ? ' · 上次测试失败' : ' · 没测试'}</small></li>
          {/each}
          {#if f.keyLine.on && f.mihomo.on}<li><i>·</i><b>重点线路</b><small class="mono">{f.keyLine.name || f.keyLine.group}</small></li>{/if}
        </ul>
        {#if !hasModule(f)}
          <p class="hint2 warnline"><Icon name="warn" /><span>至少要填一个设备。没有设备可以先看演示。</span></p>
        {/if}
        <p class="hint2"><Icon name="shield" /><span>{profiles.secretsPersistent ? '密码和 secret 存在系统 Keystore 里，不以明文落盘；导出配置时默认不带密码。' : '当前是浏览器调试环境，密码只存在内存里，刷新页面后要重新填写。装到手机上会存进系统 Keystore。'}</span></p>
        <div class="actions">
          <button class="btn pri" disabled={!hasModule(f) || saving} onclick={save}>{saving ? '正在保存' : base ? '保存修改' : '保存并开始使用'}</button>
        </div>
      </section>
      {#if first}<button class="btn ghost" onclick={enterDemo}>还是先看看演示</button>{/if}
    {/if}
  {/if}
</main>

<style>
  .hero { padding: 28px 20px 20px; text-align: center; background: radial-gradient(120% 80% at 50% 0%, var(--lime-soft), transparent 60%), var(--s1); }
  .logo { width: 68px; height: 68px; border-radius: 22px; margin: 4px auto 14px; display: grid; place-items: center; background: var(--lime); color: var(--lime-ink); }
  .logo :global(svg) { width: 34px; height: 34px; }
  .hero h1 { margin: 0; font: 800 34px/1 var(--display); letter-spacing: -.03em; }
  .hero p { margin: 10px auto 0; max-width: 320px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
  .hero .foot { font-size: 11px; color: var(--ink-3); margin-top: 18px; }
  .starts { display: grid; gap: 10px; margin-top: 24px; }
  .btn.big { min-height: 52px; font-size: 15px; border-radius: 16px; }
  .btn.ghost { background: none; border-color: transparent; color: var(--ink-3); }
  .dots { display: flex; gap: 6px; margin: 2px 2px 0; }
  .dots i { flex: 1; height: 4px; border-radius: 2px; background: var(--s3); }
  .dots i.on { background: var(--lime); }
  .intro { margin: 8px 0 4px; font-size: 13px; line-height: 1.6; color: var(--ink-2); }
  .fld.pw { grid-template-columns: 72px minmax(0, 1fr) auto; }
  .eye { height: 46px; padding: 0 10px; border-radius: 13px; background: var(--s2); border: 1px solid var(--line); font-size: 12px; color: var(--ink-2); }
  .sub { display: block; margin: 4px 0 0 82px; font-size: 11px; color: var(--ink-3); }
  .res { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 10px; align-items: start; margin-top: 14px; padding: 12px; border-radius: 14px; background: var(--s2); }
  .res i { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-weight: 800; font-size: 13px; }
  .res b { display: block; font-size: 14px; }
  .res small { display: block; margin-top: 3px; font-size: 12px; line-height: 1.5; color: var(--ink-2); word-break: break-all; }
  .res.ok { background: var(--mx-mint-12-s1); } .res.ok i { background: var(--mint); color: #062b1c; }
  .res.err { background: var(--mx-coral-10); } .res.err i { background: var(--coral); color: #2b0a05; }
  .res.busy i { border: 2.5px solid var(--s3); border-top-color: var(--lime); animation: spin 0.9s linear infinite; }
  .gpick { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
  .gpick button { text-align: left; padding: 10px 12px; border-radius: 13px; background: var(--s2); border: 1.5px solid var(--line); }
  .gpick button.on { border-color: var(--lime); background: var(--lime-soft); }
  .gpick b { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gpick small { display: block; font: 500 10.5px var(--mono); color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sum { list-style: none; margin: 14px 0 0; padding: 0; }
  .sum li { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 0 10px; padding: 10px 0; border-top: 1px solid var(--line); }
  .sum li:first-child { border-top: 0; }
  .sum i { grid-row: span 2; width: 24px; height: 24px; border-radius: 50%; background: var(--s2); display: grid; place-items: center; font-style: normal; font-weight: 800; font-size: 12px; color: var(--ink-3); }
  .sum i.ok { background: var(--mint); color: #062b1c; } .sum i.bad { background: var(--coral); color: #2b0a05; }
  .sum b { font-size: 14px; }
  .sum small { font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .res.busy i { animation: none; } }
</style>
