/*
 * 用户操作：确认面板文案 + 调用连接器 + 刷新快照 + 记录。
 * 文案沿用设计稿，用户专属内容（Claude、DMIT、具体 IP）换成配置里的重点线路和分组名。
 */
import type { BandLock, ClientPolicy, Rat, UsbMode, UfiWifiBand, PortSettings, UfiDeviceToggles, Rollback, UfiLimit } from './types';
import { ask, dock, dockBusy, toast, closeSheet } from './ui.svelte';
import {
  store as s, conn, keyLine, settings, addLog, refreshProxies, refreshRouter, refreshWifi, refreshUfi,
  refreshClients, refreshConns, refreshScenes, keyLineMember, checkKeyLine, serviceName,
} from './store.svelte';
import { haptic } from './native';
import { ConnectorError } from './errors';
import { StaleError } from './session';
import { isHostname } from './validate';

const BANDS: Record<UfiWifiBand, string> = { '2.4': '2.4G', '5': '5G' };
const RAT_NAME: Record<Rat, string> = { auto: '自动', sa: '5G SA', nsa: '5G NSA', lte: '仅 4G' };
export const RATS = Object.entries(RAT_NAME) as [Rat, string][];
export const USB_MODES: { k: UsbMode; name: string; desc: string; ic: 'spark' | 'pc' | 'router' }[] = [
  { k: 'auto', name: '自动', desc: '按插入的设备自动选', ic: 'spark' },
  { k: 'rndis', name: 'RNDIS', desc: 'Windows 免驱', ic: 'pc' },
  { k: 'ecm', name: 'CDC-ECM', desc: 'OpenWrt / Linux / Mac', ic: 'router' },
];
export const POLICY: { k: ClientPolicy; name: string; short: string; desc: string; ic: 'shield' | 'home' | 'globe' }[] = [
  { k: 'rule', name: '跟随规则', short: '规则', desc: '按代理规则分流', ic: 'shield' },
  { k: 'direct', name: '全部直连', short: '直连', desc: '电视、游戏机等用', ic: 'home' },
  { k: 'proxy', name: '全部代理', short: '全代理', desc: '所有流量走代理', ic: 'globe' },
];

const fail = (e: unknown) => {
  if (e instanceof StaleError) return;
  console.error(e);
  haptic.warn();
  toast(e instanceof ConnectorError ? `失败：${e.message}` : '操作失败，请重试');
};

/** 真实 F50 暂不支持的操作：提示原因，返回 true 表示被拦下 */
function limited(k: UfiLimit): boolean {
  const why = conn.ufi?.limits?.[k];
  if (why) toast(why);
  return !!why;
}

/** 开始一个可回滚事务；已有事务进行中时拒绝 */
function guardDock(): boolean {
  if (dockBusy()) { toast('还有一项更改在等待确认'); return false; }
  return true;
}

function startDock(rb: Rollback, title: string, sub: string, keep: boolean, onDone: () => void) {
  dock({ title, sub, secs: rb.timeout, keep, autoOk: rb.autoConfirmAfter, rollback: rb, onKeep: onDone, onRevert: onDone });
}

const mainGroup = () => s.proxies?.groups.find(g => g.type === 'Selector' && g.name !== keyLine.group)?.name ?? '代理';

/* ───────── 快捷控制 ───────── */

export async function toggleRouterWifi(radioId: string) {
  const r = s.radios.find(x => x.id === radioId);
  if (!r || !conn.router) return;
  const name = r.band === '5g' ? '5G Wi-Fi' : '2.4G Wi-Fi';
  if (r.up) {
    if (!guardDock()) return;
    const ok = await ask({ title: `关闭 ${name}`, what: '如果你现在就连着它，关掉后 App 会断开', impact: [['x', `连着 ${name} 的设备全部断开`], ['r', '90 秒内不点「保留」自动重新打开']] });
    if (!ok) return;
    try {
      const rb = await conn.router.setWifiEnabled(radioId, false);
      await refreshWifi();
      toast(`${name} 已关闭`);
      addLog('ok', `${name} → 关`, '手机');
      startDock(rb, `${name} 已关闭`, '90 秒后自动重新打开', true, () => refreshWifi());
    } catch (e) { fail(e); }
  } else {
    try {
      const rb = await conn.router.setWifiEnabled(radioId, true);
      await rb.confirm();
      await refreshWifi();
      toast(`${name} 已开启`);
      addLog('ok', `${name} → 开`, '手机');
    } catch (e) { fail(e); }
  }
}

export async function toggleF50Wifi() {
  const w = s.ufiWifi;
  if (!w || !conn.ufi) return;
  if (w.on) {
    const routerSsid = s.radios[0]?.ssid;
    const ok = await ask({
      title: '关闭 F50 Wi-Fi', what: `${w.ssid} · ${w.clients} 台设备`, hz: false, ok: '关闭', icon: 'wifi',
      impact: [['i', `直接连 F50 热点的 ${w.clients} 台设备会断开`], ['i', routerSsid ? `家里 Wi-Fi ${routerSsid} 由路由器提供，不受影响` : '路由器的 Wi-Fi 不受影响'], ['r', 'F50 会少发热一点，随时可以再打开']],
    });
    if (!ok) return;
  }
  try {
    await conn.ufi.setWifi({ on: !w.on });
    s.ufiWifi = await conn.ufi.wifi();
    toast(`F50 Wi-Fi 已${w.on ? '关闭' : '开启'}`);
    addLog('ok', `F50 Wi-Fi → ${w.on ? '关' : '开'}`, '手机');
  } catch (e) { fail(e); }
}

export async function toggleData() {
  const st = s.ufi;
  if (!st || !conn.ufi) return;
  if (st.dataOn) {
    if (!guardDock()) return;
    const ok = await ask({ title: '关闭移动数据', what: 'F50 断开拨号', impact: [['x', '全家断网，经 Tailscale 访问也会断开'], ['r', '90 秒内不点「保留」自动重新打开']] });
    if (!ok) return;
  }
  try {
    const rb = await conn.ufi.setData(!st.dataOn);
    await refreshUfi();
    toast(`移动数据 已${st.dataOn ? '关闭' : '开启'}`);
    addLog('ok', `移动数据 → ${st.dataOn ? '关' : '开'}`, '手机');
    if (rb) startDock(rb, '移动数据 已关闭', '90 秒后自动重新打开', true, () => refreshUfi());
  } catch (e) { fail(e); }
}

export async function toggleNikki() {
  const r = conn.router;
  const kind = serviceName();
  if (!r || !kind) return;
  if (s.nikkiRunning) {
    const ok = await ask({ title: `停止 ${kind}`, what: `service ${kind} stop`, impact: [['x', '所有设备直连，出口变成本地 IP'], ['x', `${keyLine.name} 会断开`], ['w', '不会自动恢复']] });
    if (!ok) return;
  }
  try {
    await r.serviceAction(kind, s.nikkiRunning ? 'stop' : 'start');
    const was = s.nikkiRunning;
    await refreshRouter();
    toast(`${kind} 已${was ? '停止' : '启动'}`);
    addLog('ok', `${kind} → ${was ? '停止' : '启动'}`, '手机');
  } catch (e) { fail(e); }
}

export async function speedTest() {
  if (!conn.ufi || limited('speedTest')) return;
  try {
    const r = await conn.ufi.speedTest();
    toast(`测速完成 · ↓${(r.down / 1e6).toFixed(1)} ↑${(r.up / 1e6).toFixed(1)} Mbps`);
  } catch (e) { fail(e); }
}

export async function updateAllSubs() {
  if (!conn.mihomo) return;
  try {
    await Promise.all(s.providers.length ? s.providers.map(p => conn.mihomo!.updateProvider(p.name)) : (await conn.mihomo.getProviders()).map(p => conn.mihomo!.updateProvider(p.name)));
    s.providers = await conn.mihomo.getProviders();
    const n = s.providers.reduce((a, p) => a + p.nodeCount, 0);
    toast(`${s.providers.length} 个订阅已更新 · ${n} 节点`);
    addLog('ok', '手动更新全部订阅', `${s.providers.length} 个订阅`);
  } catch (e) { fail(e); }
}

export async function updateSub(name: string) {
  if (!conn.mihomo) return;
  try {
    await conn.mihomo.updateProvider(name);
    s.providers = await conn.mihomo.getProviders();
    const p = s.providers.find(x => x.name === name);
    toast(`${name} 已更新 · ${p?.nodeCount ?? 0} 节点`);
  } catch (e) { fail(e); }
}

export async function resetWan() {
  if (!conn.router) return;
  const dev = s.status?.wan.device ?? 'WAN';
  const ok = await ask({ title: '重置 WAN 口', what: `ip link set ${dev} down && up`, impact: [['w', '外网断开约 5 秒'], ['i', '和 WAN 看门狗自动重置是同一个动作']] });
  if (!ok) return;
  try { await conn.router.resetWan(); toast(`${dev} 已重置`); addLog('ok', `重置 WAN 口 ${dev}`, '手机'); } catch (e) { fail(e); }
}

export async function rebootF50() {
  if (!conn.ufi) return;
  const ok = await ask({ title: '重启 F50', what: '经 UFI 后台发送重启命令', impact: [['x', '全家断网约 60 秒'], ['w', '没网时 F50 时钟可能回到出厂时间，联网后自动校正']] });
  if (!ok) return;
  try { await conn.ufi.reboot(); toast('F50 正在重启'); addLog('ok', '重启 F50', '长按确认'); } catch (e) { fail(e); }
}

export async function rebootRouter() {
  if (!conn.router) return;
  const ok = await ask({ title: '重启路由器', what: 'ubus call system reboot', impact: [['x', '全家断网约 90 秒'], ['w', '重启期间 App 连不上路由器']] });
  if (!ok) return;
  try { await conn.router.reboot(); toast('路由器正在重启'); addLog('ok', '重启路由器', '长按确认'); } catch (e) { fail(e); }
}

export async function restartNetwork() {
  if (!conn.router) return;
  const ok = await ask({ title: '重启网络', what: '/etc/init.d/network restart', impact: [['x', '全家断网约 20 秒，Wi-Fi 会重连'], ['w', '代理规则会重新加载']] });
  if (!ok) return;
  try { await conn.router.restartNetwork(); toast('网络正在重启'); addLog('ok', '重启网络', '长按确认'); } catch (e) { fail(e); }
}

export async function backupRouter() {
  if (!conn.router) return;
  try {
    const name = await conn.router.backup();
    toast(`已生成 ${name}`);
    addLog('ok', '备份路由器配置', 'sysupgrade -b');
    if (conn.plugin) s.backups = await conn.plugin.backups();
  } catch (e) { fail(e); }
}

/* ───────── 重点线路、场景、代理 ───────── */

export async function switchKeyLine(member: string) {
  const cur = keyLineMember();
  if (!conn.mihomo || !cur || member === cur) return;
  const from = s.exits[cur]?.ip, to = s.exits[member]?.ip;
  const ok = await ask({
    title: `${keyLine.name} 改走 ${member}`, what: from && to ? `${from} → ${to}` : `${cur} → ${member}`, icon: 'swap',
    impact: [['w', '出口 IP 会变化，账号可能看到 IP 变化，频繁切换可能触发风控'], ['i', `只影响 ${keyLine.name} 分组，其他流量不变`]],
  });
  if (!ok) return;
  try {
    await conn.mihomo.select(keyLine.group, member);
    await refreshProxies();
    toast(`${keyLine.name} 已切换`);
    addLog('ok', `${keyLine.name} → ${member}`, '长按确认');
    checkKeyLine().catch(() => {});
  } catch (e) { fail(e); }
}

export async function applyScene(id: string) {
  const sc = s.scenes.find(x => x.id === id);
  if (!sc || !conn.plugin || id === s.activeScene) return;
  const ok = await ask({ title: `切换到「${sc.name}」`, what: '一次改好下面几项', impact: sc.steps, hz: sc.hazard, ok: sc.hazard ? undefined : '切换', icon: sc.hazard ? 'warn' : sc.icon });
  if (!ok) return;
  try {
    await conn.plugin.applyScene(id);
    await Promise.all([refreshScenes(), refreshProxies()]);
    toast(`已切换到「${sc.name}」`);
    addLog('ok', `场景 → ${sc.name}`, '手机');
  } catch (e) { fail(e); }
}

export async function setMode(m: 'rule' | 'global' | 'direct', label: string) {
  if (!conn.mihomo || m === s.mode) return;
  if (m !== 'rule') {
    const ok = await ask({
      title: `切换到${label}模式`, what: `mihomo mode: ${m}`,
      impact: m === 'direct'
        ? [['x', '所有流量直连，出口变成本地 IP'], ['x', `${keyLine.name} 也会直连`]]
        : [['w', `所有流量走 ${mainGroup()}，国内网站会变慢`], ['w', `${keyLine.name} 也会走 ${mainGroup()}`]],
    });
    if (!ok) return;
  }
  try { await conn.mihomo.setMode(m); s.mode = m; toast(`已切换到${label}模式`); addLog('ok', `代理模式 → ${label}`, '手机'); } catch (e) { fail(e); }
}

export async function selectNode(group: string, member: string) {
  if (!conn.mihomo) return;
  try {
    await conn.mihomo.select(group, member);
    await refreshProxies();
    toast(`${group} → ${member}`);
    addLog('ok', `${group} → ${member}`, '手机');
  } catch (e) { fail(e); }
}

export async function testGroup(group: string) {
  if (!conn.mihomo) return;
  try { await conn.mihomo.testGroup(group); await refreshProxies(); toast('测速完成'); } catch (e) { fail(e); }
}

export async function closeAllConns() {
  if (!conn.mihomo) return;
  const n = s.conns?.connections.length ?? 0;
  const ok = await ask({ title: '断开全部连接', what: `DELETE /connections · ${n} 条`, hz: false, icon: 'plug', impact: [['i', '下载、视频会中断一下然后自动重连'], ['i', '切换节点后想让旧连接立刻走新线路时用']] });
  if (!ok) return;
  try { await conn.mihomo.closeAllConnections(); await refreshConns(); toast(`已断开 ${n} 条连接`); } catch (e) { fail(e); }
}

export async function closeConn(id: string, host: string) {
  if (!conn.mihomo) return;
  try { await conn.mihomo.closeConnection(id); await refreshConns(); toast(`已断开 ${host}`); } catch (e) { fail(e); }
}

export async function verifyKeyLine() {
  try {
    const info = await checkKeyLine();
    if (!info) return;
    const same = !keyLine.expectIp || info.ip === keyLine.expectIp;
    toast(`出口 ${info.ip}${info.residential ? ' · 住宅 IP' : ''} · ${same ? '与期望一致' : '和期望的不一样'}`);
  } catch (e) { fail(e); }
}

export async function routeDomain(domain: string, target: string, label: string, wasKeyLine: boolean) {
  if (!conn.plugin) return;
  const ok = await ask({
    title: `${domain} 改走${label}`, what: `DOMAIN-SUFFIX,${domain}`, icon: 'swap',
    hz: wasKeyLine, ok: wasKeyLine ? undefined : '添加规则',
    impact: wasKeyLine
      ? [['x', `这是 ${keyLine.name} 的域名，改走别的线路会让对方看到 IP 变化`], ['w', '可能需要重新登录或验证']]
      : [['i', '加到「我的规则」，排在订阅规则前面'], ['i', '订阅更新不会覆盖'], ['r', '随时可以在「我的规则」里删掉']],
  });
  if (!ok) return false;
  try {
    await conn.plugin.addMyRule(domain, target);
    s.myRules = await conn.plugin.myRules();
    toast(`已添加：${domain} → ${label}`);
    addLog('ok', `规则 ${domain} → ${label}`, '我的规则');
    return true;
  } catch (e) { fail(e); return false; }
}

export async function removeRule(domain: string) {
  if (!conn.plugin) return;
  const ok = await ask({ title: '删除规则', what: domain, hz: false, ok: '删除', icon: 'plug', impact: [['i', '删掉后这个域名按订阅规则走']] });
  if (!ok) return;
  try { await conn.plugin.removeMyRule(domain); s.myRules = await conn.plugin.myRules(); toast(`已删除 ${domain}`); } catch (e) { fail(e); }
}

export async function stopKernel() { await toggleNikki(); }

/* ───────── F50 ───────── */

export async function applyBands(picked: BandLock) {
  // 界面传进来的是 $state 代理，连接器拿到的要是普通对象
  const pick: BandLock = { nr: [...picked.nr], lte: [...picked.lte] };
  const u = conn.ufi;
  const cur = s.bands?.current;
  if (!u || !cur || !guardDock()) return;
  const fmt = (b: BandLock) => `${b.nr.join('+') || '—'} / ${b.lte.join('+') || '—'}`;
  const was = [...cur.nr, ...cur.lte].join(' + ');
  const to = fmt(pick);
  const ok = await ask({ title: 'F50 改锁频段', what: `${was} → ${to}`, impact: [['w', '切换时 5G 会断开 5–20 秒'], ['r', `60 秒内测不通外网就自动恢复成 ${was}`], ['i', '解锁会先写全部频段再写空，避免基带不放开']] });
  if (!ok) return;
  try {
    const rb = await u.lockBands(pick);
    dock({
      title: `F50 锁频 ${to}`, sub: '正在检测网络，不通会自动恢复', secs: rb.timeout, autoOk: rb.autoConfirmAfter, rollback: rb,
      async onKeep() { s.bands = await u.bands(); addLog('ok', `F50 锁频 → ${to}`, '网络检测通过'); },
      async onRevert() { s.bands = await u.bands(); addLog('rb', `F50 锁频 ${to} → 已恢复`, '超时或手动'); },
    });
    s.bands = await u.bands();
  } catch (e) { fail(e); }
}

export async function setF50Band(band: UfiWifiBand) {
  if (!conn.ufi) return;
  try { await conn.ufi.setWifi({ band }); s.ufiWifi = await conn.ufi.wifi(); toast(`F50 Wi-Fi 改为${BANDS[band]}`); } catch (e) { fail(e); }
}
export const bandName = (b: UfiWifiBand) => BANDS[b];

export async function setF50Hidden(on: boolean) {
  if (!conn.ufi || limited('hidden')) return;
  try { await conn.ufi.setWifi({ hidden: on }); s.ufiWifi = await conn.ufi.wifi(); toast(`隐藏 Wi-Fi 名称 已${on ? '开启' : '关闭'}`); addLog('ok', `F50 隐藏 Wi-Fi 名称 → ${on ? '开' : '关'}`, '手机'); } catch (e) { fail(e); }
}

export async function setUsb(m: UsbMode) {
  const u = conn.ufi;
  if (!u || m === s.usb) return;
  const to = USB_MODES.find(x => x.k === m)!, from = USB_MODES.find(x => x.k === s.usb)!;
  const ok = await ask({
    title: `USB 模式改为 ${to.name}`, what: `${from.name} → ${to.name}`, hz: false, ok: '切换', icon: 'usb2',
    impact: [['i', 'F50 的 USB 会断开再重新连接，直插的电脑/路由器断网几秒'], ['i', 'F50 当主机接 OTG 网卡时这个模式不生效'], ...(m === 'ecm' ? [['w', 'Windows 10 没有 ECM 驱动，切到 ECM 后直插电脑会认不出网卡'] as ['w', string]] : [])],
  });
  if (!ok) return;
  try { await u.setUsbMode(m); s.usb = m; toast(`USB 模式已改为 ${to.name}`); addLog('ok', `F50 USB 模式 → ${to.name}`, '手机'); } catch (e) { fail(e); }
}

export async function setRat(r: Rat) {
  const u = conn.ufi;
  if (!u || r === s.rat || !guardDock()) return;
  const old = s.rat, oldN = RAT_NAME[old], nn = RAT_NAME[r];
  const ok = await ask({ title: `网络制式改为${nn}`, what: `${oldN} → ${nn}`, impact: [['w', '切换时会断网 5–20 秒'], ['r', `60 秒内测不通外网就自动改回${oldN}`], ...(r === 'lte' ? [['w', '仅 4G 时网速上限明显变低，延迟也会变高'] as ['w', string]] : [])] });
  if (!ok) return;
  try {
    const rb = await u.setRat(r);
    s.rat = r;
    dock({
      title: `网络制式 ${nn}`, sub: '正在检测网络，不通会自动恢复', secs: rb.timeout, autoOk: rb.autoConfirmAfter, rollback: rb,
      onKeep() { addLog('ok', `F50 网络制式 → ${nn}`, '网络检测通过'); },
      async onRevert() { s.rat = await u.rat(); addLog('rb', `F50 网络制式 ${nn} → 恢复${oldN}`, '超时或手动'); },
    });
  } catch (e) { fail(e); }
}

export async function setRoaming(on: boolean) {
  const u = conn.ufi;
  if (!u) return;
  if (on && !(await ask({ title: '开启数据漫游', what: '国内出省不需要开', hz: false, ok: '开启', icon: 'cell', impact: [['w', '出境使用会产生漫游费用']] }))) return;
  try { await u.setRoaming(on); await refreshUfi(); toast(`数据漫游 已${on ? '开启' : '关闭'}`); addLog('ok', `F50 数据漫游 → ${on ? '开' : '关'}`, '手机'); } catch (e) { fail(e); }
}

export async function setAirplane(on: boolean) {
  const u = conn.ufi;
  if (!u || limited('airplane')) return;
  if (on) {
    if (!guardDock()) return;
    const ok = await ask({ title: '开启飞行模式', what: 'F50 基带断开', impact: [['x', '全家断网，经 Tailscale 访问也会断开'], ['r', '30 秒后自动关闭飞行模式，重新注册网络']] });
    if (!ok) return;
  }
  try {
    const rb = await u.setAirplane(on);
    await refreshUfi();
    toast(`飞行模式 已${on ? '开启' : '关闭'}`);
    if (rb) {
      dock({
        title: '飞行模式中', sub: '到时间自动关闭，重新连接 5G', secs: rb.timeout, autoOk: rb.autoConfirmAfter,
        rollback: { ...rb, confirm: () => rb.revert() },
        async onKeep() { await refreshUfi(); toast('飞行模式已关闭，5G 已重新连接'); },
        async onRevert() { await refreshUfi(); },
      });
    }
  } catch (e) { fail(e); }
}

export async function redial() {
  const u = conn.ufi;
  if (!u) return;
  const ok = await ask({ title: '重新拨号', what: '断开再连接移动数据', hz: false, ok: '重新拨号', icon: 'sync', impact: [['w', '断网约 5 秒，公网 IP 可能会变'], ['i', '网速突然变慢或拨号卡住时用']] });
  if (!ok) return;
  try { await u.redial(); toast(`已重新拨号 · ${s.ufi?.signal.network ?? ''}`); addLog('ok', 'F50 重新拨号', '手机'); } catch (e) { fail(e); }
}

export async function setF50Toggle(k: keyof UfiDeviceToggles, on: boolean) {
  const u = conn.ufi;
  if (!u) return;
  const names = { led: '指示灯', adb: '有线 ADB', fotaBlock: '拦截系统更新' };
  if (k === 'fotaBlock' && !on) {
    if (limited('fotaUnblock')) return;
    const ok = await ask({ title: '取消拦截系统更新', what: '删除 FOTA 的 iptables 规则', impact: [['x', '中兴可能自动升级固件，UFI-TOOLS 和插件可能失效'], ['w', '新固件可能关掉 ADB，之后很难再装回来']] });
    if (!ok) return;
  }
  try { await u.setToggle(k, on); s.toggles = await u.toggles(); toast(`${names[k]} 已${on ? '开启' : '关闭'}`); addLog('ok', `F50 ${names[k]} → ${on ? '开' : '关'}`, '手机'); } catch (e) { fail(e); }
}

export async function startOptimizer() {
  const was = s.bands ? [...s.bands.current.nr, ...s.bands.current.lte].join(' + ') : '当前频段';
  const ok = await ask({ title: '开始智能寻优', what: '逐个频段测速 · 约 3 分钟', hz: false, ok: '开始', icon: 'spark', impact: [['w', '过程中会多次切换频段，网络时断时续'], ['r', `结束后锁定最快组合；全部失败就恢复 ${was}`]] });
  if (ok) toast('寻优已开始，完成后通知你');
}

/* ───────── 路由器 ───────── */

export async function setChannel(radioId: string, ch: string) {
  const r = s.radios.find(x => x.id === radioId);
  if (!r || !conn.router || ch === r.channel || !guardDock()) return;
  const old = r.channel;
  const band = r.band === '5g' ? '5G' : '2.4G';
  const ok = await ask({ title: `${band} 信道改为 ${ch}`, what: `${old} → ${ch}`, hz: false, ok: '应用（90 秒内确认）', icon: 'wifi', impact: [['w', 'Wi-Fi 断开几秒，手机会自动重连'], ['r', `90 秒内不点「保留」自动改回 ${old}`]] });
  if (!ok) return;
  try {
    const rb = await conn.router.setWifiChannel(radioId, ch);
    await refreshWifi();
    dock({
      title: `${band} 信道已改为 ${ch}`, sub: `连回来后点「保留」，否则改回 ${old}`, secs: rb.timeout, keep: true, rollback: rb,
      onKeep() { addLog('ok', `${band} 信道 ${old} → ${ch}`, '手机确认'); },
      async onRevert() { await refreshWifi(); addLog('rb', `${band} 信道 → 恢复 ${old}`, '未确认'); },
    });
  } catch (e) { fail(e); }
}

export async function setPort(k: Exclude<keyof PortSettings, 'watchdogResetsToday'>, on: boolean) {
  const p = conn.plugin;
  if (!p) return;
  const names = { wanWatchdog: 'WAN 看门狗', eeeOff: '关闭节能以太网', led: '路由器指示灯', sshLanOnly: 'SSH 只允许内网' };
  const dev = s.status?.wan.device ?? 'WAN';
  let ok = true;
  if (k === 'eeeOff') ok = await ask({ title: on ? '关闭节能以太网（EEE）' : '恢复节能以太网（EEE）', what: `ethtool --set-eee ${dev} eee ${on ? 'off' : 'on'}`, hz: false, ok: '应用', icon: 'plug', impact: [['w', 'WAN 口重新协商，断网约 3 秒'], ['i', '用来排查网卡断线；看一天断线次数有没有变少']] });
  else if (k === 'wanWatchdog' && !on) ok = await ask({ title: '关闭 WAN 看门狗', what: '插件 wan-watchdog', hz: false, ok: '关闭', icon: 'plug', impact: [['w', `${dev} 卡住时不会再自动恢复，要手动重置`], ['i', '排查网线问题、想看原始断线情况时可以临时关']] });
  else if (k === 'sshLanOnly' && !on) ok = await ask({ title: '允许外网 SSH', what: 'dropbear 监听所有接口', impact: [['x', 'WAN 口会暴露 22 端口'], ['w', '外网访问建议走 Tailscale']] });
  if (!ok) return;
  try { await p.setPort(k, on); s.ports = await p.ports(); toast(`${names[k]} 已${on ? '开启' : '关闭'}`); addLog('ok', `${names[k]} → ${on ? '开' : '关'}`, '手机'); } catch (e) { fail(e); }
}

/* ───────── 单个设备 ───────── */

export async function setClientPolicy(mac: string, policy: ClientPolicy) {
  const p = conn.plugin, c = s.clients.find(x => x.mac === mac);
  if (!p || !c || s.controls[mac]?.policy === policy) return;
  const pol = POLICY.find(x => x.k === policy)!;
  if (c.isSelf && policy === 'direct') {
    const ok = await ask({ title: '本机改为全部直连', what: `${c.name} · ${c.mac}`, hz: false, ok: '改为直连', icon: 'home', impact: [['w', `这台手机访问 ${keyLine.name} 的网站会用本地 IP`], ['i', '只影响这一台，其他设备不变']] });
    if (!ok) return;
  }
  try { await p.setClientPolicy(mac, policy); await refreshClients(); toast(`${c.name} → ${pol.name}`); addLog('ok', `${c.name} 代理方式 → ${pol.name}`, '插件访问控制'); } catch (e) { fail(e); }
}

export async function setClientLimit(mac: string, mbps: number) {
  const p = conn.plugin, c = s.clients.find(x => x.mac === mac);
  if (!p || !c) return;
  try { await p.setClientLimit(mac, mbps); await refreshClients(); toast(mbps ? `${c.name} 限速 ${mbps} Mbps` : `${c.name} 已取消限速`); } catch (e) { fail(e); }
}

/** 只能用合法主机名：名字写进 DHCP 的 host 段；中文备注要等插件 */
export async function renameClient(mac: string, name: string): Promise<boolean> {
  const c = s.clients.find(x => x.mac === mac);
  const n = name.trim();
  if (!conn.router || !c) return false;
  if (n === c.name) return true;
  if (!isHostname(n)) { toast('只能用英文字母、数字和连字符'); return false; }
  try {
    await conn.router.renameClient(mac, n);
    await refreshClients();
    toast(`已改名为 ${n}`);
    addLog('ok', `${c.name} 改名为 ${n}`, 'DHCP 主机名');
    return true;
  } catch (e) { fail(e); return false; }
}

export async function setClientFixed(mac: string, on: boolean) {
  const c = s.clients.find(x => x.mac === mac);
  if (!conn.router || !c) return;
  try { await conn.router.setStaticLease(mac, on ? c.ip : null, c.name); await refreshClients(); toast(`${c.name} ${on ? '已固定 IP' : '改为自动分配 IP'}`); addLog('ok', `${c.name} ${on ? '固定 IP' : '取消固定 IP'}`, '手机'); } catch (e) { fail(e); }
}

export async function setClientBlocked(mac: string, on: boolean) {
  const p = conn.plugin, c = s.clients.find(x => x.mac === mac);
  if (!p || !c) return;
  if (on) {
    const ok = await ask({
      title: `暂停 ${c.name} 上网`, what: c.mac, hz: !!c.isSelf, ok: c.isSelf ? undefined : '暂停', icon: 'plug',
      impact: c.isSelf ? [['x', '这就是你现在用的手机，暂停后 App 也会断开'], ['r', '5 分钟后自动恢复，或用别的设备恢复']] : [['i', '还能连 Wi-Fi，但上不了外网'], ['i', '随时可以在这里恢复']],
    });
    if (!ok) return;
  }
  try {
    const rb = await p.setClientBlocked(mac, on);
    await refreshClients();
    toast(`${c.name} 已${on ? '暂停' : '恢复'}上网`);
    addLog('ok', `${c.name} ${on ? '暂停上网' : '恢复上网'}`, '手机');
    if (rb) { closeSheet(); dock({ title: `${c.name} 已暂停上网`, sub: '5 分钟后自动恢复', secs: rb.timeout, keep: true, rollback: rb, onKeep() {}, onRevert() { refreshClients(); } }); }
  } catch (e) { fail(e); }
}

/* ───────── 更多页 ───────── */

export async function readAllAlerts() {
  if (!conn.plugin) return;
  await conn.plugin.markAlertsRead();
  s.alerts = await conn.plugin.alerts();
  toast('已全部标为已读');
}

export async function setThreshold(k: 'temp' | 'quota' | 'wan', dir: number) {
  const p = conn.plugin, t = s.thresholds;
  if (!p || !t) return;
  const lim = { temp: [45, 75, 1], quota: [50, 100, 5], wan: [1, 60, 1] }[k];
  const v = Math.min(lim[1], Math.max(lim[0], t[k] + lim[2] * dir));
  // 先改本地再写设备，连续快点时每次都基于最新值
  s.thresholds = { ...t, [k]: v };
  await p.setThresholds({ [k]: v });
}

export async function setKeyLineAlert(on: boolean) {
  const p = conn.plugin, t = s.thresholds;
  if (!p || !t) return;
  s.thresholds = { ...t, keyLineExit: on };
  await p.setThresholds({ keyLineExit: on });
}

export async function toggleTask(id: string) {
  const p = conn.plugin, t = s.tasks.find(x => x.id === id);
  if (!p || !t) return;
  await p.setTaskEnabled(id, !t.enabled);
  s.tasks = await p.tasks();
  toast(`「${t.name}」已${t.enabled ? '停用' : '启用'}`);
  addLog('ok', `定时任务「${t.name}」→ ${t.enabled ? '停用' : '启用'}`, 'cron');
}

export const TASK_TEMPLATES: [string, 'moon' | 'power' | 'cell' | 'spark' | 'gauge' | 'leaf', string, string][] = [
  ['夜间关闭 Wi-Fi', 'moon', '每天 01:00 – 07:00', '0 1 * * *'],
  ['定时重启路由器', 'power', '每周日 05:00', '0 5 * * 0'],
  ['晚高峰换频段', 'cell', '每天 19:00 锁 n78，23:00 恢复', '0 19 * * *'],
  ['定时切换场景', 'spark', '工作日 09:00 切「专注」', '0 9 * * 1-5'],
  ['每天测速', 'gauge', '每天 03:00', '0 3 * * *'],
  ['流量快用完时省流', 'leaf', '月流量 > 90% 自动切「省流」', '*/30 * * * *'],
];

export async function addTaskFromTemplate(i: number) {
  const p = conn.plugin;
  if (!p) return;
  const [name, icon, schedule, cron] = TASK_TEMPLATES[i];
  await p.addTask({ name, icon, schedule, cron, enabled: true });
  s.tasks = await p.tasks();
  closeSheet();
  toast(`已新建「${name}」，可以再改时间`);
}

export async function restoreBackup(id: string, label: string) {
  const p = conn.plugin;
  if (!p) return;
  const ok = await ask({ title: '恢复配置备份', what: label, impact: [['x', '路由器会重启，全家断网约 2 分钟'], ['w', '备份之后改过的设置会丢失'], ['i', '恢复前会先自动备份一份当前配置']] });
  if (!ok) return;
  try { await p.restore(id); toast('正在恢复，路由器即将重启'); } catch (e) { fail(e); }
}

export async function logout() {
  const ok = await ask({ title: '退出登录', what: '路由器 rpcd 会话', hz: false, ok: '退出', icon: 'shield', impact: [['i', '下次打开要重新输入密码'], ['i', '密码仍保存在本机 Keystore，可在设置向导里删除']] });
  if (!ok) return;
  await conn.router?.logout();
  toast(conn.profile.demo ? '演示模式下不会真的退出' : '已退出');
}

export function setHold(ms: number) { settings.holdMs = ms; toast(`危险操作改为长按 ${ms / 1000} 秒`); }
