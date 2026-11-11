/*
 * 全局状态。快照一律用 $state.raw：整体替换、不做深层代理，省内存。
 * 页面挂载时调用 load*() 拉一次，再用 poll() 登记需要定时刷新的部分。
 */
import type {
  AlertItem, AlertThresholds, BackupItem, BandLock, ClientControl, Connectors, ConnectionsSnapshot,
  ExitInfo, KeyLine, LogEntry, MyRule, PluginFeature, PortSettings, Profile, ProxyMode, ProxyProvider,
  ProxySnapshot, Rat, RouterBoard, RouterClient, RouterStatus, Rule, ScheduledTask, Scene, Sms,
  UfiDeviceToggles, UfiStatus, UfiWifi, UsageMonth, UsbMode, WifiRadio, MihomoConnection, LogStatus,
} from './types';
import { createMockConnectors, DEMO_PROFILE } from './mock';
import { createConnectors } from './connectors';
import { createProfileStore } from './profiles';
import { createSecretStore } from './secure';
import { Backoff, describeError, fence, StaleError, type ErrorView, type ModuleKey } from './session';
import { beforeEachTick, setPollInterval } from './poll';
import { setSystemBars } from './native';
import { probe } from './rules';

export type Page = 'home' | 'proxy' | 'dev' | 'more';
export type Theme = 'auto' | 'dark' | 'light';

const HIST = 48;
const SIG = 40;
const MB = 1024 * 1024;

/* ───────── 设置（只存在这台手机上） ───────── */

interface Settings {
  theme: Theme;
  holdMs: number;
  refresh: number;
  saver: boolean;
}
const SETTINGS_KEY = 'homenet.settings';
function readSettings(): Settings {
  const def: Settings = { theme: 'auto', holdMs: 1000, refresh: 2, saver: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return def; }
}

export const settings = $state<Settings>(readSettings());

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 隐私模式等 */ }
  applySettings();
}

const darkMq = matchMedia('(prefers-color-scheme: dark)');
export const isDark = () => (settings.theme === 'auto' ? darkMq.matches : settings.theme === 'dark');

export function applySettings() {
  const r = document.documentElement;
  if (settings.theme === 'auto') delete r.dataset.theme;
  else r.dataset.theme = settings.theme;
  r.classList.toggle('saver', settings.saver);
  setSystemBars(isDark());
  setPollInterval(settings.refresh);
}
darkMq.addEventListener('change', () => { if (settings.theme === 'auto') setSystemBars(isDark()); });

/* ───────── 连接器 ───────── */

const localKV = {
  getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式等 */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};
export const profiles = createProfileStore(localKV, createSecretStore(), DEMO_PROFILE);

/** 没配重点线路时的占位：group 为空，不会匹配任何分组，相关卡片整块不显示 */
const NO_KEY_LINE: KeyLine = { id: '', name: '重点线路', group: '', domains: [] };

/*
 * conn / keyLine 随当前配置替换（ES 模块的导出是活绑定，各处 import 到的都是最新值）。
 * 界面不是响应式地读它们，所以 App 用 {#key store.session} 在切换配置时整页重建。
 */
export let conn: Connectors = { profile: DEMO_PROFILE };
export let keyLine: KeyLine = NO_KEY_LINE;
let session = 0;

/* ───────── 数据 ───────── */

export type Health = ErrorView | 'ok';

class Store {
  /** 每次切换配置加一；界面用它整页重建 */
  session = $state(0);
  /** boot：读配置中；welcome：还没有配置（首次打开）；app：正常使用 */
  view = $state<'boot' | 'welcome' | 'app'>('boot');
  /** 各模块最近一次请求的结果；没有记录表示还没连过 */
  health = $state.raw<Partial<Record<ModuleKey, Health>>>({});
  page = $state<Page>('home');
  features = $state.raw<PluginFeature[]>([]);

  board = $state.raw<RouterBoard | null>(null);
  status = $state.raw<RouterStatus | null>(null);
  clients = $state.raw<RouterClient[]>([]);
  controls = $state.raw<Record<string, ClientControl>>({});
  radios = $state.raw<WifiRadio[]>([]);
  nikkiRunning = $state(true);

  mihomoVersion = $state('');
  mode = $state<ProxyMode>('rule');
  proxies = $state.raw<ProxySnapshot | null>(null);
  /** 分组名 → 最近一次核对的出口 */
  exits = $state.raw<Record<string, ExitInfo>>({});
  conns = $state.raw<ConnectionsSnapshot | null>(null);
  providers = $state.raw<ProxyProvider[]>([]);
  rules = $state.raw<Rule[]>([]);
  myRules = $state.raw<MyRule[]>([]);
  top = $state.raw<{ name: string; bytes: number; via: string }[]>([]);

  ufi = $state.raw<UfiStatus | null>(null);
  ufiWifi = $state.raw<UfiWifi | null>(null);
  bands = $state.raw<{ current: BandLock; supported: BandLock } | null>(null);
  usb = $state<UsbMode>('rndis');
  rat = $state<Rat>('auto');
  toggles = $state.raw<UfiDeviceToggles | null>(null);
  sms = $state.raw<Sms[]>([]);

  alerts = $state.raw<AlertItem[]>([]);
  thresholds = $state.raw<AlertThresholds | null>(null);
  tasks = $state.raw<ScheduledTask[]>([]);
  usage = $state.raw<UsageMonth | null>(null);
  wanEvents = $state.raw<number[]>([]);
  ports = $state.raw<PortSettings | null>(null);
  backups = $state.raw<BackupItem[]>([]);
  scenes = $state.raw<Scene[]>([]);
  activeScene = $state('');
  log = $state.raw<LogEntry[]>([]);

  /** 网速历史，单位 MB/s，固定 48 点 */
  speedDown = $state.raw<number[]>([]);
  speedUp = $state.raw<number[]>([]);
  /** 信号历史，已换算到 0–100，固定 40 点 */
  rsrpHist = $state.raw<number[]>([]);
  sinrHist = $state.raw<number[]>([]);

  /** 首页连通性：站点 → 经哪个分组、延迟 */
  reach = $state.raw<{ name: string; via: string; delay: number | null }[]>([]);
  reachAt = $state(0);

  has(f: PluginFeature) { return this.features.includes(f); }

  /** 切换配置时清空上一套的快照 */
  reset() {
    this.health = {}; this.features = [];
    this.board = null; this.status = null; this.clients = []; this.controls = {}; this.radios = []; this.nikkiRunning = true;
    this.mihomoVersion = ''; this.mode = 'rule'; this.proxies = null; this.exits = {}; this.conns = null; this.providers = []; this.rules = []; this.myRules = []; this.top = [];
    this.ufi = null; this.ufiWifi = null; this.bands = null; this.usb = 'rndis'; this.rat = 'auto'; this.toggles = null; this.sms = [];
    this.alerts = []; this.thresholds = null; this.tasks = []; this.usage = null; this.wanEvents = []; this.ports = null; this.backups = []; this.scenes = []; this.activeScene = ''; this.log = [];
    this.speedDown = []; this.speedUp = []; this.rsrpHist = []; this.sinrHist = [];
    this.reach = []; this.reachAt = 0;
  }
}

export const store = new Store();
const s = store;

/* ───────── 配置切换 ───────── */

/** 用一套配置创建连接器；旧连接器还没回来的请求结果作废，旧轮询随页面重建注销 */
export function activate(p: Profile) {
  const my = ++session;
  const raw = p.demo ? createMockConnectors() : createConnectors(p, { allowPublic: p.allowPublic });
  beforeEachTick(p.demo ? () => (raw as ReturnType<typeof createMockConnectors>).tick() : null);
  conn = fence(raw, () => my === session);
  keyLine = p.keyLines[0] ?? NO_KEY_LINE;
  s.reset();
  backoff.clear();
  s.page = 'home';
  s.session = my;
  s.view = 'app';
}

export async function switchProfile(id: string) {
  const p = await profiles.load(id);
  profiles.setCurrent(id);
  activate(p);
}

/** 启动：有选中的配置就用它，否则进欢迎页 */
export async function boot() {
  const id = profiles.currentId();
  if (!id) { s.view = 'welcome'; return; }
  try { await switchProfile(id); } catch { s.view = 'welcome'; }
}

/** 删掉当前配置等情况：回到欢迎页 */
export function deactivate() {
  ++session;
  beforeEachTick(null);
  conn = { profile: DEMO_PROFILE };
  keyLine = NO_KEY_LINE;
  s.reset();
  s.session = session;
  s.view = 'welcome';
}

const backoff = new Backoff();

/**
 * 记录模块健康状态。失败时返回 undefined，不往外抛：刷新失败由错误卡片展示，不打断其他模块。
 * 连续失败的模块在退避期内直接跳过，不发请求。
 */
async function track<T>(m: ModuleKey, run: () => Promise<T>): Promise<T | undefined> {
  if (!backoff.ready(m)) return undefined;
  try {
    const r = await run();
    backoff.ok(m);
    if (s.health[m] !== 'ok') s.health = { ...s.health, [m]: 'ok' };
    return r;
  } catch (e) {
    if (e instanceof StaleError) return undefined;
    if (backoff.fail(m)) console.warn(m, e);
    s.health = { ...s.health, [m]: describeError(e, m) };
    return undefined;
  }
}

export const moduleError = (m: ModuleKey): ErrorView | undefined => {
  const h = s.health[m];
  return h && h !== 'ok' ? h : undefined;
};

/* ───────── 首屏 ───────── */

export async function loadCore() {
  const tasks: Promise<unknown>[] = [];
  if (conn.plugin) tasks.push(conn.plugin.features().then(f => (s.features = f)).catch(() => {}));
  const r = conn.router;
  if (r) tasks.push(refreshRouter(), track('router', () => r.board()).then(b => { if (b) s.board = b; }));
  if (conn.mihomo) {
    const m = conn.mihomo;
    tasks.push(refreshProxies(), track('mihomo', () => m.getMode()).then(v => { if (v) s.mode = v; }), track('mihomo', () => m.version()).then(v => { if (v) s.mihomoVersion = v.version; }));
  }
  if (conn.ufi) tasks.push(refreshUfi());
  await Promise.allSettled(tasks);
  if (conn.plugin) {
    await Promise.allSettled([
      s.has('alerts') && refreshAlerts(),
      s.has('scenes') && refreshScenes(),
    ]);
  }
  if (keyLine.group && conn.mihomo) checkKeyLine().catch(() => {});
  seedHistory();
}

/** 演示模式下先铺一段曲线，和设计稿一样一打开就有图；真实设备从第一次采样开始 */
function seedHistory() {
  if (conn.profile.demo) {
    s.speedDown = Array.from({ length: HIST }, (_, i) => 3 + Math.sin(i / 5) * 1.5 + Math.random() * 1.5);
    s.speedUp = Array.from({ length: HIST }, () => 0.3 + Math.random() * 0.3);
    s.rsrpHist = Array.from({ length: SIG }, (_, i) => 60 + Math.sin(i / 4) * 8 + Math.random() * 6);
    s.sinrHist = Array.from({ length: SIG }, (_, i) => 30 + Math.cos(i / 5) * 10 + Math.random() * 8);
  }
}

const push = (arr: number[], v: number, n: number) => (arr.length ? [...arr.slice(arr.length >= n ? 1 : 0), v] : Array(n).fill(v));

/** 路由器上代理服务的 init 脚本名；手动填的 mihomo 不知道是哪个服务，返回 undefined */
export const serviceName = () => {
  const k = conn.profile.mihomo?.kind;
  return conn.router && (k === 'nikki' || k === 'openclash') ? k : undefined;
};

/* ───────── 刷新函数：失败只记进 health，不往外抛 ───────── */

export async function refreshSpeed() {
  const m = conn.mihomo;
  const r = m ? await track('mihomo', () => m.traffic()) : s.status?.wan.rate;
  if (!r) return;
  s.speedDown = push(s.speedDown, r.down / MB, HIST);
  s.speedUp = push(s.speedUp, r.up / MB, HIST);
}

export async function refreshRouter() {
  const r = conn.router;
  if (!r) return;
  const svc = serviceName();
  const res = await track('router', () => Promise.all([r.status(), svc ? r.serviceRunning(svc).catch(() => true) : Promise.resolve(true)]));
  if (!res) return;
  s.status = res[0];
  s.nikkiRunning = res[1];
}

export async function refreshClients() {
  const r = conn.router;
  if (!r) return;
  const list = await track('router', () => r.clients());
  if (!list) return;
  s.clients = list;
  if (conn.plugin && s.has('client-policy')) {
    const ctl = await conn.plugin.clientControls().catch(() => null);
    if (ctl) s.controls = Object.fromEntries(ctl.map(c => [c.mac, c]));
  }
}

export async function refreshWifi() {
  const rt = conn.router;
  if (!rt) return;
  const r = await track('router', () => rt.wifi());
  if (r) s.radios = r;
}

export async function refreshProxies() {
  const m = conn.mihomo;
  if (!m) return;
  const p = await track('mihomo', () => m.getProxies());
  if (p) s.proxies = p;
}

export async function refreshConns() {
  const m = conn.mihomo;
  if (!m) return;
  const c = await track('mihomo', () => m.getConnections());
  if (c) s.conns = c;
}

export async function refreshProxyPage() {
  const m = conn.mihomo;
  if (!m) return;
  const tasks: Promise<unknown>[] = [
    refreshProxies(),
    refreshConns(),
    track('mihomo', () => m.getProviders()).then(p => { if (p) s.providers = p; }),
    track('mihomo', () => m.getRules()).then(r => { if (r) s.rules = r; }),
  ];
  if (conn.plugin && s.has('my-rules')) tasks.push(conn.plugin.myRules().then(r => (s.myRules = r)));
  if (conn.plugin && s.has('traffic-top')) tasks.push(refreshTop('domain'));
  if (!s.clients.length) tasks.push(refreshClients());
  await Promise.allSettled(tasks);
}

export async function refreshTop(by: 'domain' | 'device') {
  if (conn.plugin) s.top = await conn.plugin.trafficTop(by);
}

const toPct = (v: number, lo: number, hi: number) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));

export async function refreshUfi() {
  const u = conn.ufi;
  if (!u) return;
  const st = await track('ufi', () => u.status());
  if (!st) return;
  s.ufi = st;
  s.rsrpHist = push(s.rsrpHist, toPct(st.signal.rsrp, -140, -44), SIG);
  s.sinrHist = push(s.sinrHist, toPct(st.signal.sinr, -10, 30), SIG);
}

/** F50 页的各项分别读，一项失败（比如短信接口）不影响别的 */
export async function loadF50() {
  const u = conn.ufi;
  if (!u) return;
  await Promise.allSettled([
    track('ufi', () => u.wifi()).then(v => { if (v) s.ufiWifi = v; }),
    track('ufi', () => u.bands()).then(v => { if (v) s.bands = v; }),
    track('ufi', () => u.usbMode()).then(v => { if (v) s.usb = v; }),
    track('ufi', () => u.rat()).then(v => { if (v) s.rat = v; }),
    track('ufi', () => u.toggles()).then(v => { if (v) s.toggles = v; }),
    u.sms().then(v => (s.sms = v), () => {}),
  ]);
}

export async function loadRouterPage() {
  const r = conn.router;
  await Promise.allSettled([
    refreshRouter(), refreshClients(), refreshWifi(),
    !s.board && r && track('router', () => r.board()).then(b => { if (b) s.board = b; }),
    conn.plugin && s.has('wan-watchdog') && conn.plugin.ports().then(p => (s.ports = p)),
    conn.plugin && conn.plugin.wanEvents().then(e => (s.wanEvents = e)),
  ]);
}

export async function refreshAlerts() {
  if (!conn.plugin) return;
  const [a, t] = await Promise.all([conn.plugin.alerts(), conn.plugin.thresholds()]);
  s.alerts = a; s.thresholds = t;
}

export async function refreshScenes() {
  if (!conn.plugin) return;
  const r = await conn.plugin.scenes();
  s.scenes = r.list; s.activeScene = r.active;
}

export async function loadMore() {
  const p = conn.plugin;
  if (!p) return;
  await Promise.allSettled([
    refreshAlerts(),
    p.tasks().then(t => (s.tasks = t)),
    p.usage().then(u => (s.usage = u)),
    p.backups().then(b => (s.backups = b)),
    p.log().then(l => (s.log = l)),
  ]);
}

/** 重试：重新拉首屏，并让当前页按需补拉 */
export async function retryAll() {
  backoff.clear();
  s.health = {};
  await loadCore();
  await Promise.allSettled([refreshWifi(), refreshClients(), loadF50(), refreshConns()]);
}

export async function addLog(status: LogStatus, action: string, detail: string) {
  if (!conn.plugin) return;
  await conn.plugin.addLog({ status, action, detail });
  s.log = await conn.plugin.log();
}

const REACH_SITES: [string, string][] = [['Claude', 'claude.ai'], ['Google', 'www.google.com'], ['GitHub', 'github.com'], ['YouTube', 'www.youtube.com'], ['哔哩哔哩', 'www.bilibili.com']];

/** 按规则找到每个站点走的分组，再经该分组测一次延迟 */
export async function refreshReach() {
  const m = conn.mihomo;
  if (!m) return;
  if (!s.rules.length) {
    const r = await track('mihomo', () => m.getRules());
    if (!r) return;
    s.rules = r;
  }
  if (!s.proxies) await refreshProxies();
  if (!s.proxies) return;
  const myRules = conn.plugin && s.has('my-rules') ? (s.myRules.length ? s.myRules : await conn.plugin.myRules()) : [];
  s.reach = await Promise.all(REACH_SITES.map(async ([name, host]) => {
    const r = probe(host, s.rules, myRules, s.proxies!);
    const target = r?.target ?? 'DIRECT';
    const delay = await m.testNode(target, `https://${host}`).catch(() => null);
    return { name, via: target === 'DIRECT' ? '直连' : `经 ${target}`, delay };
  }));
  s.reachAt = Date.now();
}

/* ───────── 重点线路 ───────── */

export async function checkKeyLine(): Promise<ExitInfo | null> {
  if (!conn.mihomo || !keyLine?.checkUrl) return null;
  const member = keyLineMember();
  const info = await conn.mihomo.checkExit(keyLine.group, keyLine.checkUrl);
  if (member) s.exits = { ...s.exits, [member]: info };
  return info;
}

export function keyLineMember(): string | undefined {
  return s.proxies?.groups.find(g => g.name === keyLine.group)?.now;
}

/** 连接属于哪一类：重点线路 / 代理 / 直连 */
export function connKind(c: MihomoConnection): 'key' | 'proxy' | 'direct' {
  if (c.chains.includes(keyLine.group)) return 'key';
  if (c.chains.length === 1 && c.chains[0] === 'DIRECT') return 'direct';
  return 'proxy';
}

export function deviceName(ip: string): string {
  return s.clients.find(c => c.ip === ip)?.name ?? ip;
}

export function go(p: Page) {
  if (s.page === p) return;
  s.page = p;
  scrollTo({ top: 0 });
}
