<script lang="ts">
  import { ui, closeSheet, toast, type SheetState } from '../lib/ui.svelte';
  import { store as s, conn } from '../lib/store.svelte';
  import { POLICY, TASK_TEMPLATES, addTaskFromTemplate, setClientPolicy, setClientLimit, setClientFixed, setClientBlocked, renameClient } from '../lib/actions';
  import { isHostname } from '../lib/validate';
  import { mbs, gb } from '../lib/format';
  import Icon from './parts/Icon.svelte';
  import Switch from './parts/Switch.svelte';
  import Chan from './parts/Chan.svelte';
  import { clientColor, clientIcon } from './devices/client';

  let last = $state.raw<SheetState | null>(null);
  $effect(() => { if (ui.sheet) last = ui.sheet; });
  const view = $derived(ui.sheet ?? last);
  const c = $derived(view?.kind === 'client' ? s.clients.find(x => x.mac === view.mac) : undefined);
  const ctl = $derived(c ? s.controls[c.mac] : undefined);
  const LIMITS: [string, string][] = [['0', '不限'], ['50', '50M'], ['10', '10M'], ['2', '2M']];

  /* ── 改名：写进 DHCP 主机名，只能是合法主机名 ── */
  let renaming = $state(false);
  let newName = $state('');
  let saving = $state(false);
  $effect(() => { if (!ui.sheet) renaming = false; });
  const nameOk = $derived(isHostname(newName.trim()));
  function startRename() { newName = c && isHostname(c.name) ? c.name : ''; renaming = true; }
  async function doRename() {
    if (!c || !nameOk) return;
    saving = true;
    try { if (await renameClient(c.mac, newName)) renaming = false; } finally { saving = false; }
  }
</script>

<style>
  .rename { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; margin-top: 12px; }
  .rename input { min-width: 0; height: 40px; border-radius: 12px; border: 1.5px solid var(--line-2); background: var(--s2); color: var(--ink); padding: 0 12px; font: 500 14px var(--mono); outline: none; }
  .rename input:focus { border-color: var(--lime); }
  .rename input[aria-invalid='true'] { border-color: var(--coral); }
  .rename small { grid-column: 1 / -1; font-size: 11px; line-height: 1.5; color: var(--ink-3); }
  .rename small.bad { color: var(--coral); }
</style>

<div class="scrim" id="dscrim" class:show={!!ui.sheet} role="presentation" onclick={e => e.target === e.currentTarget && closeSheet()}>
  <div class="sheet dsheet" role="dialog" aria-modal="true">
    <span class="grab"></span>
    {#if view?.kind === 'client' && c}
      {@const color = clientColor(c)}
      <div class="dhead">
        <span class="av" style="background:{color}38;color:{color}"><Icon name={clientIcon(c)} /></span>
        <div><h3>{c.name}{#if c.isSelf}<em class="tag me">本机</em>{/if}</h3><p class="mono">{c.ip} · {c.mac}</p></div>
        {#if conn.router}<button class="btn sm" onclick={() => (renaming ? (renaming = false) : startRename())}>{renaming ? '取消' : '改名'}</button>{/if}
      </div>
      {#if renaming}
        <div class="rename">
          <input bind:value={newName} placeholder="例如 Living-Room-TV" maxlength="63" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" onkeydown={e => e.key === 'Enter' && doRename()} aria-label="新名字" aria-invalid={!!newName.trim() && !nameOk} />
          <button class="btn sm pri" disabled={!nameOk || saving} onclick={doRename}>{saving ? '保存中' : '保存'}</button>
          <small class:bad={!!newName.trim() && !nameOk}>只能用英文字母、数字和连字符，最长 63 位：名字会写进路由器的 DHCP 主机名。中文备注要等路由器插件。</small>
        </div>
      {/if}
      <div class="dstats">
        <div><small>下载</small><b class="disp">{ctl?.blocked ? '—' : mbs(c.rate.down)}<u>MB/s</u></b></div>
        <div><small>上传</small><b class="disp" style="color:var(--sky)">{ctl?.blocked ? '—' : mbs(c.rate.up)}<u>MB/s</u></b></div>
        <div><small>今天</small><b class="disp">{gb(c.todayBytes ?? 0, 2)}<u>GB</u></b></div>
      </div>
      {#if ctl}
        <div class="lbl" style="margin-top:16px">代理方式<span class="r mono dim">按 MAC 区分</span></div>
        <div class="opts">
          {#each POLICY as p (p.k)}
            <button class="opt" class:on={ctl.policy === p.k} onclick={() => setClientPolicy(c.mac, p.k)}><span class="oic"><Icon name={p.ic} /></span><b>{p.name}</b><small>{p.desc}</small></button>
          {/each}
        </div>
        <div class="lbl" style="margin-top:16px">限速</div>
        <Chan style="margin-top:8px" options={LIMITS} value={String(ctl.limitMbps)} onpick={k => setClientLimit(c.mac, +k)} />
      {/if}
      <div class="swrow"><b>固定 IP</b><Switch on={c.staticLease} onchange={v => setClientFixed(c.mac, v)} label="固定 IP" /><small>每次连上都分配 {c.ip}</small></div>
      {#if ctl}
        <div class="swrow"><b>暂停上网</b><Switch on={ctl.blocked} onchange={v => setClientBlocked(c.mac, v)} label="暂停上网" /><small>还能连 Wi-Fi，但上不了外网</small></div>
        <div class="lbl" style="margin-top:12px">今天常去</div>
        <div class="chips2" style="margin-top:8px">{#each ctl.topDomains as t (t.domain)}<span>{t.domain} {gb(t.bytes)}G</span>{/each}</div>
      {:else if !conn.plugin}
        <p class="hint2"><Icon name="info" /><span>代理方式、限速、暂停上网需要在路由器上安装 HomeNet 插件。</span></p>
      {/if}
      <div class="acts" style="margin-top:18px;grid-template-columns:1fr"><button class="btn" onclick={closeSheet}>完成</button></div>
    {:else if view?.kind === 'newtask'}
      <h3 style="margin:6px 0 4px;font-size:19px">新建定时任务</h3>
      <p class="what" style="margin:0 0 14px;font:500 12px var(--mono);color:var(--ink-3)">选一个模板，建好后再改时间</p>
      <div class="tpls">
        {#each TASK_TEMPLATES as [n, ic, sch], i (n)}
          <button class="opt" onclick={() => addTaskFromTemplate(i)}><span class="oic"><Icon name={ic} /></span><b style="font-family:var(--sans)">{n}</b><small>{sch}</small></button>
        {/each}
      </div>
      <div class="acts" style="margin-top:16px;display:grid"><button class="btn" onclick={closeSheet}>取消</button></div>
    {/if}
  </div>
</div>
