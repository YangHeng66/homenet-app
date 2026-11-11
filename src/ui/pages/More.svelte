<script lang="ts">
  import { onMount } from 'svelte';
  import { store as s, conn, keyLine, settings, saveSettings, loadMore, type Theme } from '../../lib/store.svelte';
  import { toast, openSheet, openScreen } from '../../lib/ui.svelte';
  import { modulesText } from '../../lib/profile-actions';
  import { readAllAlerts, setThreshold, setKeyLineAlert, toggleTask, backupRouter, restoreBackup, logout, setHold } from '../../lib/actions';
  import { ago, gb, when } from '../../lib/format';
  import type { LogStatus } from '../../lib/types';
  import Icon from '../parts/Icon.svelte';
  import Switch from '../parts/Switch.svelte';
  import Chan from '../parts/Chan.svelte';

  let ttl = $state(0);
  onMount(() => {
    loadMore();
    conn.router?.sessionTtl().then(t => (ttl = t), () => {});
  });

  /* ── 流量 ── */
  const u = $derived(s.usage);
  const used = $derived(u ? u.daily.reduce((a, b) => a + b, 0) : 0);
  const days = $derived(u?.daily.length ?? 0);
  const avg = $derived(days ? used / days : 0);
  const monthLen = $derived(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
  const est = $derived(avg * monthLen);
  const over = $derived(!!u && est > u.quota);
  const C = 2 * Math.PI * 42;
  const lead = $derived((new Date(new Date().getFullYear(), new Date().getMonth(), 1).getDay() + 6) % 7);
  const maxDay = $derived(u ? Math.max(...u.daily) : 1);

  /* ── 告警 ── */
  const unread = $derived(s.alerts.filter(a => a.unread).length);
  type NotifyMode = 'app' | 'sys' | 'bg';
  let notify = $state<NotifyMode>('app');
  const NOTIFY_HINT: Record<NotifyMode, string> = {
    app: '只有打开 App 时才看得到。',
    sys: '用安卓系统通知提醒，App 在前台或刚切到后台时有效（M2）。',
    bg: '用 WorkManager 每 15 分钟在后台检查一次，手机关屏也能提醒（M2）。',
  };

  /* ── 操作记录 ── */
  let lf = $state<'all' | LogStatus>('all');
  const LF: ['all' | LogStatus, string][] = [['all', '全部'], ['ok', '成功'], ['rb', '已恢复'], ['err', '失败']];
  const logShown = $derived(lf === 'all' ? s.log : s.log.filter(l => l.status === lf));
  const cnt = (k: 'all' | LogStatus) => (k === 'all' ? s.log.length : s.log.filter(l => l.status === k).length);

  /* ── 设置 ── */
  function setTheme(t: Theme) { settings.theme = t; saveSettings(); }
  function setRefresh(v: string) { settings.refresh = +v; saveSettings(); toast(`改为每 ${v} 秒刷新`); }
  function holdPick(v: string) { setHold(+v); saveSettings(); }
  function setSaver(v: boolean) { settings.saver = v; saveSettings(); toast(v ? '省电模式已开启：关掉毛玻璃和装饰动画' : '省电模式已关闭'); }

  const STEPS = ['路由器装 Tailscale', '登录授权', '批准子网路由', '手机装 Tailscale'];
  const kind = conn.profile.mihomo?.kind ?? 'mihomo';
  const about = $derived([
    s.board && ['路由器', `${s.board.release} · ${s.board.model}`],
    s.mihomoVersion && [kind, `mihomo ${s.mihomoVersion}`],
    s.ufi && ['F50', `${s.ufi.firmware} · UFI-TOOLS ${s.ufi.ufiVersion}`],
    ['HomeNet', `0.1.0 · ${conn.profile.demo ? '演示模式，数据都是假的' : '数据只在设备和这台手机之间传，不经过任何外部服务器'}`],
  ].filter(Boolean) as [string, string][]);
</script>

<main class="page">
  {#if u}
    <section class="card pad full">
      <div class="lbl">流量 · {new Date().getMonth() + 1} 月<span class="r mono dim">每月 {u.resetDay} 日重置</span></div>
      <div class="usage-top">
        <svg class="uring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--s3)" stroke-width="10" /><circle cx="50" cy="50" r="42" fill="none" stroke={over ? 'var(--amber)' : 'var(--lime)'} stroke-width="10" stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={C * (1 - Math.min(1, used / u.quota))} transform="rotate(-90 50 50)" /><text x="50" y="50" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="22" fill="var(--ink)">{gb(used)}</text><text x="50" y="66" text-anchor="middle" font-family="Geist Mono" font-size="9" fill="var(--ink-3)">/ {gb(u.quota, 0)} GB</text></svg>
        <div class="ustats">
          <div><small>今天</small><b class="disp">{gb(u.daily.at(-1) ?? 0)}<u>GB</u></b></div>
          <div><small>日均</small><b class="disp">{gb(avg)}<u>GB</u></b></div>
          <div class:warnbox={over}><small>按现在速度，月底</small><b class="disp">{gb(est, 0)}<u>GB</u></b>{#if over}<em>会超 {gb(est - u.quota, 0)} GB</em>{/if}</div>
        </div>
      </div>
      <div class="cal">
        {#each ['一', '二', '三', '四', '五', '六', '日'] as d (d)}<span class="wd">{d}</span>{/each}
        {#each Array(lead) as _, i (i)}<span></span>{/each}
        {#each Array(monthLen) as _, i (i)}
          {@const v = u.daily[i]}
          {@const a = v ? 0.18 + (v / maxDay) * 0.82 : 0}
          <span class="day" class:fut={v === undefined} class:today={i === days - 1} class:hi={a >= 0.9} style={v ? `--a:${a.toFixed(2)}` : ''} title={v ? `${i + 1}日 ${gb(v)} GB` : ''}>{i + 1}</span>
        {/each}
      </div>
      <div class="actions"><button class="btn" onclick={() => toast('套餐设置还没做：总量、重置日（M3）')}><Icon name="cell" />套餐 {gb(u.quota, 0)} GB · 修改</button></div>
    </section>
  {/if}

  {#if conn.plugin && s.has('alerts') && s.thresholds}
    {@const t = s.thresholds}
    <section class="card">
      <div class="ghead"><div class="t"><b>告警</b><small>{unread ? `${unread} 条未读` : '全部已读'}</small></div>{#if unread}<button class="btn sm" onclick={readAllAlerts}>全部已读</button>{/if}</div>
      <ul class="alist">
        {#each s.alerts as a (a.id)}<li class:unread={a.unread}><span class="lv {a.level}"></span><b>{a.title}</b><time>{ago(a.time)}</time><small>{a.detail}</small></li>{/each}
      </ul>
      <div class="pad" style="padding-top:4px">
        <div class="lbl">提醒条件</div>
        {#each [['temp', '°', 'F50 温度超过', 'F50 到一定温度会自己限速'], ['quota', '%', '月流量用到', `按套餐 ${u ? gb(u.quota, 0) : 100} GB 算`], ['wan', ' 次', 'WAN 每小时断开超过', '看门狗每次重置算一次']] as [k, unit, name, sub] (k)}
          {@const kk = k as 'temp' | 'quota' | 'wan'}
          <div class="swrow"><b>{name}</b><span class="stepper"><button aria-label="减少" onclick={() => setThreshold(kk, -1)}>−</button><output>{t[kk]}{unit}</output><button aria-label="增加" onclick={() => setThreshold(kk, 1)}>+</button></span><small>{sub}</small></div>
        {/each}
        <div class="swrow"><b>{keyLine.name} 出口变化</b><Switch on={t.keyLineExit} onchange={setKeyLineAlert} label="出口变化提醒" /><small>{keyLine.expectIp ? `不是 ${keyLine.expectIp} 时马上提醒` : '出口 IP 变了就提醒'}</small></div>
        <div class="lbl" style="margin-top:14px">提醒方式</div>
        <Chan style="margin-top:8px" options={[['app', 'App 内'], ['sys', '系统通知'], ['bg', '后台检查']]} value={notify} onpick={k => (notify = k)} />
        <p class="hint2"><Icon name="info" /><span>{NOTIFY_HINT[notify]}</span></p>
      </div>
    </section>
  {/if}

  {#if conn.plugin && s.has('tasks')}
    <section class="card">
      <div class="ghead"><div class="t"><b>定时任务</b><small>由路由器 cron 执行，手机关了也照常跑</small></div><button class="btn sm pri" onclick={() => openSheet({ kind: 'newtask' })}>新建</button></div>
      <div class="list">
        {#each s.tasks as t (t.id)}
          <div class="li"><span class="ic" class:live={t.enabled}><Icon name={t.icon} /></span><b>{t.name}</b><small>{t.schedule}{t.enabled && t.next ? ' · 下次 ' + when(t.next) : ''}</small><Switch on={t.enabled} onchange={() => toggleTask(t.id)} label={t.name} /></div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="card pad">
    <div class="lbl">远程访问 · Tailscale<span class="r"><em class="tag">未检测</em></span></div>
    <p class="rdesc">装好后在外面用手机流量，也能控制家里的路由器、代理和 F50，不用开放任何端口。</p>
    <ol class="steps">{#each STEPS as st, i (st)}<li class:cur={i === 0}><span>{i + 1}</span>{st}</li>{/each}</ol>
    <p class="hint2"><Icon name="info" /><span>安卓同一时间只能开一个 VPN：在外面要用时先关手机上的代理 App，再开 Tailscale。</span></p>
    <div class="actions"><button class="btn" onclick={() => toast('步骤说明随使用文档一起发布')}>查看步骤</button></div>
  </section>

  {#if conn.plugin && s.has('backup')}
    <section class="card">
      <div class="ghead"><div class="t"><b>备份</b><small>路由器配置 · 代理配置 · 插件设置</small></div><button class="btn sm" onclick={backupRouter}>立即备份</button></div>
      <div class="list">
        {#each s.backups as b (b.id)}
          {@const label = `${when(b.time)} · ${b.auto ? '自动' : '手动'} · ${Math.round(b.size / 1024)} KB`}
          <div class="li"><span class="ic"><Icon name="down" /></span><b>{b.name}</b><small>{label}</small><button class="btn sm" onclick={() => restoreBackup(b.id, label)}>恢复</button></div>
        {/each}
      </div>
    </section>
  {/if}

  {#if conn.plugin && s.has('log')}
    <section class="card full">
      <div class="ghead"><div class="t"><b>操作记录</b><small>最近 24 小时 · 保存在路由器上</small></div></div>
      <div class="cfilter">{#each LF as [k, n] (k)}<button class:on={lf === k} onclick={() => (lf = k)}>{n}<small>{cnt(k)}</small></button>{/each}</div>
      <ul class="log">
        {#each logShown as l (l.time + l.action)}<li><span class="st {l.status}"></span><b>{l.action}</b><time>{when(l.time, '')}</time><small>{l.detail}</small></li>{/each}
      </ul>
    </section>
  {/if}

  <section class="card">
    <div class="ghead"><div class="t"><b>设置</b><small>只影响这台手机</small></div></div>
    <div class="pad" style="padding-top:2px">
      <div class="lbl">外观</div>
      <Chan style="margin:6px 0 2px" options={[['auto', '跟随系统'], ['dark', '深色'], ['light', '浅色']]} value={settings.theme} onpick={setTheme} />
      <div class="lbl" style="margin-top:12px">危险操作长按时间</div>
      <Chan style="margin:6px 0 2px" options={[['600', '0.6 秒'], ['1000', '1 秒'], ['1500', '1.5 秒']]} value={String(settings.holdMs)} onpick={holdPick} />
      <div class="lbl" style="margin-top:12px">刷新间隔</div>
      <Chan style="margin:6px 0 2px" options={[['2', '2 秒'], ['5', '5 秒'], ['10', '10 秒']]} value={String(settings.refresh)} onpick={setRefresh} />
      <div class="swrow" style="margin-top:6px"><b>省电模式</b><Switch on={settings.saver} onchange={setSaver} label="省电模式" /><small>关掉毛玻璃和装饰动画</small></div>
    </div>
    <div class="list" style="border-top:1px solid var(--line)">
      <div class="li"><span class="ic"><Icon name="home" /></span><b>当前配置</b><small>{conn.profile.name} · {modulesText(conn.profile)}</small><button class="btn sm" onclick={() => openScreen({ kind: 'profiles' })}>切换</button></div>
      {#if conn.router}
        <div class="li"><span class="ic"><Icon name="shield" /></span><b>路由器会话</b><small>{conn.profile.router?.username ?? 'root'} · {Math.round(ttl / 60)} 分钟后过期</small><button class="btn sm" onclick={logout}>退出</button></div>
      {/if}
    </div>
  </section>

  <section class="card">
    <div class="ghead"><div class="t"><b>关于</b><small>HomeNet · 家庭网络控制</small></div></div>
    <div class="list">{#each about as [n, sub] (n)}<div class="li"><span class="ic"><Icon name="info" /></span><b>{n}</b><small>{sub}</small></div>{/each}</div>
  </section>
</main>
