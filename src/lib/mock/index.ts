/*
 * 演示模式连接器：实现 types.ts 的全部接口，数据在内存里，不发网络请求。
 * 所有 IP 用文档保留段（203.0.113.0/24、198.51.100.0/24）和 OpenWrt 默认网段，
 * 节点名、订阅名、Wi-Fi 名都是示例。
 */
import type {
  AlertItem, AlertThresholds, BackupItem, BandLock, ClientControl, ClientPolicy, ConnectionsSnapshot,
  ExitInfo, KeyLine, Latency, LogEntry, MihomoConnection, MihomoConnector, MockConnectors, MyRule,
  OpenWrtRpcConnector, PluginConnector, PortSettings, Profile, ProxyGroup, ProxyMode, ProxyNode,
  ProxyProvider, Rat, Rate, Rollback, RouterClient, Rule, ScheduledTask, Scene, Sms, UfiConnector,
  UfiDeviceToggles, UfiStatus, UfiWifi, UsageMonth, UsbMode, WifiRadio,
} from '../types';

const KB = 1024, MB = KB * 1024, GB = MB * 1024;
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const now = () => Date.now();
const wait = (ms = 120) => new Promise<void>(r => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const jitter = (v: number, f = 0.3) => v * (1 - f + Math.random() * 2 * f);
const clone = <T>(v: T): T => structuredClone(v);

export const DEMO_KEY_LINE: KeyLine = {
  id: 'ai',
  name: 'AI 专线',
  group: 'AI 专线',
  expectIp: '203.0.113.24',
  checkUrl: 'https://ip.example.com/json',
  domains: ['claude.ai', 'anthropic.com', 'claudeusercontent.com', 'openai.com', 'chatgpt.com'],
};

export const DEMO_PROFILE: Profile = {
  id: 'demo',
  name: '演示模式',
  demo: true,
  router: { url: 'http://192.168.1.1', username: 'root' },
  mihomo: { url: 'http://192.168.1.1:9090', kind: 'nikki' },
  ufi: { url: 'http://192.168.0.1:2333' },
  keyLines: [DEMO_KEY_LINE],
};

function node(name: string, type: string, region: string | undefined, delay: Latency): ProxyNode {
  return { name, type, region, udp: type === 'Hysteria2', alive: delay != null, delay };
}

function createWorld() {
  const nodes: Record<string, ProxyNode> = {};
  [
    node('HomeA-HY2', 'Hysteria2', 'US', 168),
    node('HomeA-HY2-2', 'Hysteria2', 'US', 174),
    node('HomeA-VLESS', 'Vless', 'US', 182),
    node('Relay-HomeA', 'Relay', 'US', 410),
    node('HomeB-08', 'Vless', 'US', 192),
    node('HomeB-02', 'Vless', 'US', 186),
    node('HomeB-10', 'Vless', 'US', 205),
    node('HomeB-06', 'Vless', 'US', 214),
    node('HomeB-11', 'Vless', 'US', null),
    node('US-01', 'Shadowsocks', 'US', 231),
    node('JP-01', 'Shadowsocks', 'JP', 88),
    node('DE-03', 'Shadowsocks', 'DE', 276),
    node('DIRECT', 'Direct', 'CN', 12),
  ].forEach(n => (nodes[n.name] = n));

  const groups: ProxyGroup[] = [
    { name: '节点选择', type: 'Selector', now: '家宽 B', all: ['家宽 B', '自动选择', 'HomeB-02', 'HomeB-08', 'US-01', 'DIRECT'] },
    { name: 'AI 专线', type: 'Selector', now: '家宽 A', all: ['家宽 A', '家宽 B'] },
    { name: '家宽 A', type: 'Fallback', now: 'HomeA-HY2', all: ['HomeA-HY2', 'HomeA-HY2-2', 'HomeA-VLESS', 'Relay-HomeA'] },
    { name: '家宽 B', type: 'Fallback', now: 'HomeB-08', all: ['HomeB-08', 'HomeB-02', 'HomeB-10', 'HomeB-06', 'HomeB-11'] },
    { name: '自动选择', type: 'URLTest', now: 'JP-01', all: ['US-01', 'JP-01', 'DE-03'] },
    { name: 'YouTube', type: 'Selector', now: '节点选择', all: ['节点选择', '家宽 B', '自动选择', 'DIRECT'] },
  ];
  const groupDelay = (g: ProxyGroup): Latency => {
    const n = nodes[g.now] ?? groupNode(g.now);
    return n?.delay ?? null;
  };
  const groupNode = (name: string): ProxyNode | undefined => {
    const g = groups.find(x => x.name === name);
    return g ? { name, type: g.type, alive: true, delay: groupDelay(g) } : undefined;
  };

  const exits: Record<string, Omit<ExitInfo, 'checkedAt'>> = {
    '家宽 A': { ip: '203.0.113.24', region: 'US·TX', city: 'Dallas', isp: 'Example Cable', residential: true },
    '家宽 B': { ip: '198.51.100.73', region: 'US·CA', city: 'Irvine', isp: 'Example Fiber', residential: true },
    '自动选择': { ip: '192.0.2.18', region: 'JP·13', city: 'Tokyo', isp: 'Example DC', residential: false },
    DIRECT: { ip: '本地出口', region: 'CN', city: '', isp: '移动宽带', residential: false },
  };

  const providers: ProxyProvider[] = [
    { name: 'main-sub', vehicleType: 'HTTP', nodeCount: 55, updatedAt: now() - 5 * HOUR, subscription: { upload: 9 * GB, download: 117 * GB, total: 500 * GB, expire: Date.parse('2027-03-18') } },
    { name: 'home-a-hy2', vehicleType: 'HTTP', nodeCount: 2, updatedAt: now() - 5 * HOUR, subscription: { upload: 3 * GB, download: 38 * GB, total: 200 * GB, expire: Date.parse('2026-12-01') } },
    { name: 'home-a-vless', vehicleType: 'HTTP', nodeCount: 1, updatedAt: now() - 5 * HOUR, subscription: { upload: 3 * GB, download: 38 * GB, total: 200 * GB, expire: Date.parse('2026-12-01') } },
    { name: 'home-b', vehicleType: 'HTTP', nodeCount: 6, updatedAt: now() - 5 * HOUR },
  ];

  const rules: Rule[] = [
    { type: 'DOMAIN-SUFFIX', payload: 'claude.ai', proxy: 'AI 专线' },
    { type: 'DOMAIN-SUFFIX', payload: 'anthropic.com', proxy: 'AI 专线' },
    { type: 'DOMAIN-SUFFIX', payload: 'claudeusercontent.com', proxy: 'AI 专线' },
    { type: 'GEOSITE', payload: 'openai', proxy: 'AI 专线' },
    { type: 'GEOSITE', payload: 'youtube', proxy: 'YouTube' },
    { type: 'GEOSITE', payload: 'github', proxy: '节点选择' },
    { type: 'RULE-SET', payload: 'streaming', proxy: '节点选择' },
    { type: 'GEOSITE', payload: 'google', proxy: '节点选择' },
    { type: 'DOMAIN-KEYWORD', payload: 'bilibili', proxy: 'DIRECT' },
    { type: 'GEOSITE', payload: 'cn', proxy: 'DIRECT' },
    { type: 'GEOIP', payload: 'CN', proxy: 'DIRECT' },
    { type: 'MATCH', payload: '', proxy: '节点选择' },
  ];

  const clients: RouterClient[] = [
    { mac: '02:5A:11:3C:9E:12', ip: '192.168.1.111', name: 'Pixel 9', kind: 'phone', link: '5g', signal: -39, rate: { down: 2.1 * MB, up: 0.4 * MB }, todayBytes: 3.82 * GB, staticLease: true, online: true, isSelf: true },
    { mac: '02:5A:11:7B:04:5A', ip: '192.168.1.88', name: 'Desktop-PC', kind: 'pc', link: 'wired', linkSpeedMbps: 1000, rate: { down: 1.6 * MB, up: 0.2 * MB }, todayBytes: 1.94 * GB, staticLease: true, online: true },
    { mac: '02:5A:11:D2:61:9F', ip: '192.168.1.130', name: '客厅电视', kind: 'tv', link: '5g', signal: -58, rate: { down: 0.9 * MB, up: 0.01 * MB }, todayBytes: 0.71 * GB, staticLease: false, online: true },
    { mac: '02:5A:11:48:B7:E1', ip: '192.168.1.221', name: 'iPad', kind: 'phone', link: '5g', signal: -84, rate: { down: 0.3 * MB, up: 0.1 * MB }, todayBytes: 0.25 * GB, staticLease: false, online: true },
  ];
  const controls: ClientControl[] = [
    { mac: clients[0].mac, policy: 'rule', limitMbps: 0, blocked: false, topDomains: [{ domain: 'bilibili.com', bytes: 1.1 * GB }, { domain: 'youtube.com', bytes: 0.9 * GB }, { domain: 'claude.ai', bytes: 0.3 * GB }] },
    { mac: clients[1].mac, policy: 'rule', limitMbps: 0, blocked: false, topDomains: [{ domain: 'github.com', bytes: 0.3 * GB }, { domain: 'claude.ai', bytes: 0.3 * GB }, { domain: 'googlevideo.com', bytes: 0.2 * GB }] },
    { mac: clients[2].mac, policy: 'direct', limitMbps: 0, blocked: false, topDomains: [{ domain: 'iqiyi.com', bytes: 0.5 * GB }, { domain: 'mi.com', bytes: 0.1 * GB }] },
    { mac: clients[3].mac, policy: 'rule', limitMbps: 10, blocked: false, topDomains: [{ domain: 'apple.com', bytes: 0.1 * GB }, { domain: 'weixin.qq.com', bytes: 0.1 * GB }] },
  ];

  let connSeq = 0;
  const conn = (host: string, src: number, chains: string[], rule: string, payload: string, kbps: number): MihomoConnection => ({
    id: `c${++connSeq}`, host, destination: host ? '' : '198.51.100.9:443', network: 'tcp', sourceIp: clients[src].ip,
    chains, rule, rulePayload: payload, upload: 0, download: 0, rate: { down: kbps * KB, up: kbps * KB * 0.08 }, start: now() - Math.random() * HOUR,
  });
  const connections: MihomoConnection[] = [
    conn('claude.ai', 1, ['HomeA-HY2', '家宽 A', 'AI 专线'], 'DomainSuffix', 'claude.ai', 46),
    conn('api.anthropic.com', 1, ['HomeA-HY2', '家宽 A', 'AI 专线'], 'DomainSuffix', 'anthropic.com', 12),
    conn('rr3---sn-example.googlevideo.com', 0, ['HomeB-08', '家宽 B', '节点选择', 'YouTube'], 'GeoSite', 'youtube', 1840),
    conn('github.com', 1, ['HomeB-08', '家宽 B', '节点选择'], 'GeoSite', 'github', 88),
    conn('upos-sz-mirrorcos.bilivideo.com', 0, ['DIRECT'], 'GeoSite', 'cn', 960),
    conn('data.video.iqiyi.com', 2, ['DIRECT'], 'GeoSite', 'cn', 720),
    conn('www.google.com', 3, ['HomeB-08', '家宽 B', '节点选择'], 'Match', '', 4),
  ];

  const speed: Rate = { down: 5.24 * MB, up: 318 * KB };

  const ufi = {
    status: {
      model: 'ZTE F50', firmware: 'F50_V1.0.0B15', ufiVersion: '4.1.5', uptime: 23 * 3600,
      signal: { network: '5G SA', operator: '中国移动', bands: ['n41', 'B39'], rsrp: -86, rsrq: -12, sinr: 4, pci: 371, bars: 3 },
      temps: { board: 52, soc: 55, modem: 51, pa: 49, throttleAt: 60 },
      rate: { down: 5.24 * MB, up: 318 * KB }, dataOn: true, pdp: 'IPv4v6', roaming: false, airplane: false,
      monthBytes: 45.2 * GB, todayBytes: 6.72 * GB,
    } as UfiStatus,
    wifi: { on: true, ssid: 'F50_A1B2', band: '5', hidden: false, clients: 2 } as UfiWifi,
    bands: { nr: ['n41'], lte: ['B39'] } as BandLock,
    supported: { nr: ['n1', 'n28', 'n41', 'n78', 'n79'], lte: ['B1', 'B3', 'B5', 'B8', 'B34', 'B38', 'B39', 'B40', 'B41'] } as BandLock,
    usb: 'rndis' as UsbMode,
    rat: 'auto' as Rat,
    toggles: { led: true, adb: false, fotaBlock: true } as UfiDeviceToggles,
    sms: [
      { id: 's1', from: '10086', text: '尊敬的客户，您本月套餐内通用流量已使用 80%…', time: now() - 2 * HOUR, read: false },
      { id: 's2', from: '106', text: '【示例】您的验证码是 ****，5 分钟内有效。', time: now() - DAY, read: true },
    ] as Sms[],
  };

  const radios: WifiRadio[] = [
    { id: 'radio1', band: '5g', up: true, ssid: 'MyHome', channel: '149', channels: ['auto', '36', '44', '149', '157', '165'], htmode: 'HE80', clients: 3 },
    { id: 'radio0', band: '2g', up: false, ssid: 'MyHome', channel: 'auto', channels: ['auto', '1', '6', '11'], htmode: 'HE20', clients: 0 },
  ];

  const ports: PortSettings = { wanWatchdog: true, watchdogResetsToday: 3, eeeOff: false, led: true, sshLanOnly: true };
  const services: Record<string, boolean> = { nikki: true };

  let mode: ProxyMode = 'rule';
  const wanUpSince = now() - (17 * 3600 + 48 * 60) * 1000;
  const today = new Date();
  const dayOfMonth = today.getDate();
  const usage: UsageMonth = {
    daily: [3.1, 5.4, 4.8, 6.2, 4.4, 5.9, 3.7, 4.9, 6.7, 5.2, 4.1, 6.0, 5.5, 4.7, 3.9, 6.4, 5.1, 4.6, 5.8, 4.2, 6.1, 5.0, 4.4, 5.6, 4.9, 3.8, 5.3, 6.6, 4.5, 5.7, 4.8]
      .slice(0, dayOfMonth).map(v => v * GB),
    quota: 100 * GB,
    resetDay: 1,
  };

  const alerts: AlertItem[] = [
    { id: 'a1', level: 'bad', title: 'WAN 口 1 小时内断开 21 次', detail: '疑似网线接触问题', time: now() - 18 * MIN, unread: true },
    { id: 'a2', level: 'warn', title: '按现在速度月底会超套餐', detail: '预计 150 GB / 套餐 100 GB', time: now() - 4 * HOUR, unread: true },
    { id: 'a3', level: 'ok', title: 'F50 锁频已自动恢复', detail: 'n78 测不通外网 → n41 + B39', time: now() - DAY, unread: false },
  ];
  const thresholds: AlertThresholds = { temp: 60, quota: 80, wan: 10, keyLineExit: true };

  let taskSeq = 4;
  const tasks: ScheduledTask[] = [
    { id: 't1', name: '更新订阅', schedule: '每天 04:00', cron: '0 4 * * *', next: nextAt(4, 0), icon: 'sync', enabled: true },
    { id: 't2', name: '夜间关闭 2.4G Wi-Fi', schedule: '每天 00:30 – 07:30', cron: '30 0 * * *', next: nextAt(0, 30), icon: 'moon', enabled: false },
    { id: 't3', name: '每周重启 F50', schedule: '每周一 05:00', cron: '0 5 * * 1', next: now() + 3 * DAY, icon: 'power', enabled: false },
    { id: 't4', name: '每天测速', schedule: '每天 03:00、20:00', cron: '0 3,20 * * *', next: nextAt(20, 0), icon: 'gauge', enabled: true },
  ];

  const backups: BackupItem[] = [
    { id: 'b1', name: '配置备份', time: now() - 6 * HOUR, size: 42 * KB, auto: true },
    { id: 'b2', name: '配置备份', time: now() - DAY - 3 * HOUR, size: 39 * KB, auto: false },
  ];

  const scenes: Scene[] = [
    { id: 'daily', name: '日常', desc: 'AI→家宽 A\n其他→家宽 B', icon: 'home', hazard: false, steps: [['i', '节点选择 → 家宽 B'], ['i', 'AI 专线 → 家宽 A']] },
    { id: 'focus', name: '专注', desc: '只保 AI 专线\n其他走自动选择', icon: 'spark', hazard: false, steps: [['i', '节点选择 → 自动选择，家宽 B 只留给 AI 专线'], ['i', 'AI 专线 仍走 家宽 A']] },
    { id: 'game', name: '低延迟', desc: '游戏/视频直连\n国外走最快节点', icon: 'bolt', hazard: false, steps: [['i', '游戏和国内视频直连'], ['i', '国外流量 → 自动选择（url-test）'], ['i', 'AI 专线 不变']] },
    { id: 'save', name: '省流', desc: '限制视频清晰度\n关 2.4G', icon: 'leaf', hazard: false, steps: [['i', 'YouTube 分组 → 自动选择'], ['i', '关闭 2.4G Wi-Fi'], ['i', 'AI 专线 不变']] },
    { id: 'direct', name: '全部直连', desc: '停用代理\nAI 专线会断开', icon: 'warn', hazard: true, steps: [['x', '停用代理，所有设备走本地出口'], ['x', 'AI 专线的出口 IP 会变成本地 IP'], ['w', '要手动切回别的场景']] },
  ];
  let activeScene = 'daily';

  const myRules: MyRule[] = [
    { domain: 'openrouter.ai', target: 'AI 专线', addedAt: Date.parse('2026-11-02T10:00:00') },
    { domain: 'iqiyi.com', target: 'DIRECT', addedAt: Date.parse('2026-10-31T10:00:00') },
  ];

  const log: LogEntry[] = [
    { time: atToday(4, 0), status: 'ok', action: '订阅自动更新', detail: 'main-sub · 55 节点' },
    { time: atToday(21, 12) - DAY, status: 'rb', action: 'F50 锁频 n78 → 自动恢复', detail: '60 秒内 ping 全部失败' },
    { time: atToday(20, 47) - DAY, status: 'ok', action: '节点选择 → 家宽 B', detail: '手机 · 家里 Wi-Fi' },
    { time: atToday(17, 12) - DAY, status: 'ok', action: '重置 WAN 口 eth0', detail: 'WAN 看门狗自动' },
    { time: atToday(16, 30) - DAY, status: 'err', action: '更新订阅失败', detail: 'sub.example.com 超时，保留旧配置' },
  ];

  const wanEvents = [3, 9, 9.4, 21, 40, 41, 41.6, 58, 72, 73, 88, 89, 90.5, 96, 97, 97.5].map(p => now() - DAY + (p / 100) * DAY);

  return {
    nodes, groups, groupNode, exits, providers, rules, clients, controls, connections, speed, ufi, radios, ports,
    services, wanUpSince, usage, alerts, thresholds, tasks, backups, scenes, myRules, log, wanEvents,
    get mode() { return mode; }, set mode(v: ProxyMode) { mode = v; },
    get activeScene() { return activeScene; }, set activeScene(v: string) { activeScene = v; },
    nextTaskId: () => `t${++taskSeq}`,
  };
}

function atToday(h: number, m: number) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
function nextAt(h: number, m: number) {
  const t = atToday(h, m);
  return t > now() ? t : t + DAY;
}

let rbSeq = 0;
function rollback(timeout: number, apply: () => void, revert: () => void, autoConfirmAfter?: number): Rollback {
  apply();
  let settled = false;
  return {
    id: `rb${++rbSeq}`,
    timeout,
    autoConfirmAfter,
    async confirm() { settled = true; await wait(60); },
    async revert() { if (!settled) { settled = true; revert(); } await wait(60); },
  };
}

export function createMockConnectors(): MockConnectors {
  const w = createWorld();

  const mihomo: MihomoConnector = {
    async version() { return { version: 'v1.19.15', meta: true }; },
    async getMode() { return w.mode; },
    async setMode(m) { await wait(); w.mode = m; },
    async getProxies() {
      const nodes = clone(w.nodes);
      for (const g of w.groups) nodes[g.name] = w.groupNode(g.name)!;
      return { groups: clone(w.groups), nodes };
    },
    async select(group, member) {
      await wait();
      const g = w.groups.find(x => x.name === group);
      if (g && g.all.includes(member)) g.now = member;
    },
    async testGroup(group) {
      await wait(900);
      const g = w.groups.find(x => x.name === group);
      const out: Record<string, Latency> = {};
      for (const name of g?.all ?? []) {
        const n = w.nodes[name];
        if (n && n.delay != null) n.delay = Math.max(60, Math.round(n.delay + (Math.random() - 0.5) * 50));
        out[name] = n ? n.delay : w.groupNode(name)?.delay ?? null;
      }
      return out;
    },
    async testNode(name) { await wait(300); return (w.nodes[name] ?? w.groupNode(name))?.delay ?? null; },
    async traffic() { return { ...w.speed }; },
    async getConnections(): Promise<ConnectionsSnapshot> {
      return { uploadTotal: 12 * GB, downloadTotal: 186 * GB, connections: clone(w.connections), memory: 92 * MB };
    },
    async closeConnection(id) { await wait(60); const i = w.connections.findIndex(c => c.id === id); if (i >= 0) w.connections.splice(i, 1); },
    async closeAllConnections() { await wait(); w.connections.length = 0; },
    async getProviders() { return clone(w.providers); },
    async updateProvider(name) { await wait(1100); const p = w.providers.find(x => x.name === name); if (p) p.updatedAt = now(); },
    async getRules() { return clone(w.rules); },
    async checkExit(group) {
      await wait(1000);
      let g = w.groups.find(x => x.name === group);
      let name = group;
      while (g && !w.exits[name]) { name = g.now; g = w.groups.find(x => x.name === name); }
      return { ...(w.exits[name] ?? { ip: '未知' }), checkedAt: now() };
    },
  };

  const routerApi: OpenWrtRpcConnector = {
    async login() { await wait(); },
    async sessionTtl() { return 29 * 60; },
    async logout() { await wait(); },
    async board() { return { model: 'GL.iNet GL-MT3000', hostname: 'OpenWrt', release: 'OpenWrt 25.12.6', kernel: '6.12.40', target: 'mediatek/filogic' }; },
    async status() {
      return {
        uptime: (now() - w.wanUpSince) / 1000 + 3600, cpu: Math.round(jitter(18, 0.25)), memory: 41, memTotal: 512 * MB, temperature: 48,
        load: [0.32, 0.28, 0.25],
        wan: { up: true, uptime: (now() - w.wanUpSince) / 1000, device: 'eth0', ipv4: '10.75.12.3', speedMbps: 1000, rate: { ...w.speed } },
        lanIp: '192.168.1.1',
      };
    },
    async clients() { return clone(w.clients); },
    async setStaticLease(mac, ip) { await wait(); const c = w.clients.find(x => x.mac === mac); if (c) c.staticLease = ip != null; },
    async renameClient(mac, name) { await wait(); const c = w.clients.find(x => x.mac === mac); if (c) c.name = name; },
    async wifi() { return clone(w.radios); },
    async setWifiEnabled(id, on) {
      await wait();
      const r = w.radios.find(x => x.id === id)!;
      const old = r.up;
      return rollback(90, () => { r.up = on; }, () => { r.up = old; });
    },
    async setWifiChannel(id, ch) {
      await wait();
      const r = w.radios.find(x => x.id === id)!;
      const old = r.channel;
      return rollback(90, () => { r.channel = ch; }, () => { r.channel = old; });
    },
    async detectMihomo() { return { url: 'http://192.168.1.1:9090', kind: 'nikki' }; },
    async serviceAction(name, action) { await wait(400); w.services[name] = action !== 'stop'; },
    async serviceRunning(name) { return !!w.services[name]; },
    async resetWan() { await wait(600); },
    async restartNetwork() { await wait(600); },
    async reboot() { await wait(600); },
    async backup() {
      await wait(800);
      const d = new Date();
      const name = `backup-openwrt-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.tar.gz`;
      w.backups.unshift({ id: `b${w.backups.length + 1}`, name: '配置备份', time: now(), size: 42 * KB, auto: false });
      return name;
    },
  };

  const ufiApi: UfiConnector = {
    async login() { await wait(); },
    async status() { return clone(w.ufi.status); },
    async bands() { return { current: clone(w.ufi.bands), supported: clone(w.ufi.supported) }; },
    async lockBands(lock) {
      await wait();
      const old = clone(w.ufi.bands);
      return rollback(60, () => { w.ufi.bands = clone(lock); }, () => { w.ufi.bands = old; }, 6);
    },
    async wifi() { return clone(w.ufi.wifi); },
    async setWifi(patch) { await wait(); Object.assign(w.ufi.wifi, patch); w.ufi.wifi.clients = w.ufi.wifi.on ? 2 : 0; },
    async usbMode() { return w.ufi.usb; },
    async setUsbMode(m) { await wait(); w.ufi.usb = m; },
    async rat() { return w.ufi.rat; },
    async setRat(r) { await wait(); const old = w.ufi.rat; return rollback(60, () => { w.ufi.rat = r; }, () => { w.ufi.rat = old; }, 6); },
    async setData(on) {
      await wait();
      const s = w.ufi.status;
      if (on) { s.dataOn = true; return; }
      return rollback(90, () => { s.dataOn = false; }, () => { s.dataOn = true; });
    },
    async setRoaming(on) { await wait(); w.ufi.status.roaming = on; },
    async setAirplane(on) {
      await wait();
      const s = w.ufi.status;
      if (!on) { s.airplane = false; return; }
      return rollback(30, () => { s.airplane = true; }, () => { s.airplane = false; }, 30);
    },
    async redial() { await wait(800); },
    async toggles() { return clone(w.ufi.toggles); },
    async setToggle(k, on) { await wait(); w.ufi.toggles[k] = on; },
    async sms() { return clone(w.ufi.sms); },
    async speedTest() { await wait(1400); return { down: 48.2e6, up: 12.6e6 }; },
    async reboot() { await wait(600); },
  };

  const plugin: PluginConnector = {
    async version() { return '0.3.0'; },
    async features() {
      return ['client-policy', 'client-limit', 'client-block', 'my-rules', 'alerts', 'tasks', 'usage', 'backup', 'wan-watchdog', 'eee', 'router-led', 'ssh-lan-only', 'scenes', 'traffic-top', 'log'];
    },
    async clientControls() { return clone(w.controls); },
    async setClientPolicy(mac, policy: ClientPolicy) { await wait(); const c = w.controls.find(x => x.mac === mac); if (c) c.policy = policy; },
    async setClientLimit(mac, mbps) { await wait(); const c = w.controls.find(x => x.mac === mac); if (c) c.limitMbps = mbps; },
    async setClientBlocked(mac, blocked) {
      await wait();
      const c = w.controls.find(x => x.mac === mac)!;
      const self = w.clients.find(x => x.mac === mac)?.isSelf;
      if (blocked && self) return rollback(300, () => { c.blocked = true; }, () => { c.blocked = false; });
      c.blocked = blocked;
    },
    async myRules() { return clone(w.myRules); },
    async addMyRule(domain, target) {
      await wait();
      const i = w.myRules.findIndex(r => r.domain === domain);
      if (i >= 0) w.myRules.splice(i, 1);
      w.myRules.unshift({ domain, target, addedAt: now() });
    },
    async removeMyRule(domain) { await wait(); const i = w.myRules.findIndex(r => r.domain === domain); if (i >= 0) w.myRules.splice(i, 1); },
    async alerts() { return clone(w.alerts); },
    async markAlertsRead() { await wait(); w.alerts.forEach(a => (a.unread = false)); },
    async thresholds() { return clone(w.thresholds); },
    async setThresholds(p) { Object.assign(w.thresholds, p); },
    async tasks() { return clone(w.tasks); },
    async setTaskEnabled(id, on) { await wait(); const t = w.tasks.find(x => x.id === id); if (t) t.enabled = on; },
    async addTask(t) { await wait(); const task = { ...t, id: w.nextTaskId() }; w.tasks.push(task); return clone(task); },
    async usage() { return clone(w.usage); },
    async setQuota(quota, resetDay) { w.usage.quota = quota; w.usage.resetDay = resetDay; },
    async trafficTop(by) {
      if (by === 'device') return w.clients.map((c, i) => ({ name: c.name, bytes: c.todayBytes ?? 0, via: i === 2 ? '直连' : '规则' }));
      return [
        { name: 'youtube.com', bytes: 1.84 * GB, via: 'YouTube → 家宽 B' },
        { name: 'bilibili.com', bytes: 1.21 * GB, via: '直连' },
        { name: 'claude.ai', bytes: 0.62 * GB, via: 'AI 专线 → 家宽 A' },
        { name: 'github.com', bytes: 0.31 * GB, via: '节点选择 → 家宽 B' },
        { name: 'googlevideo.com', bytes: 0.24 * GB, via: 'YouTube → 家宽 B' },
      ];
    },
    async wanEvents() { return [...w.wanEvents]; },
    async ports() { return clone(w.ports); },
    async setPort(k, on) { await wait(); w.ports[k] = on; },
    async backups() { return clone(w.backups); },
    async restore() { await wait(800); },
    async scenes() { return { list: clone(w.scenes), active: w.activeScene }; },
    async applyScene(id) { await wait(); w.activeScene = id; },
    async log() { return clone(w.log); },
    async addLog(e) { w.log.unshift({ ...e, time: now() }); },
  };

  const connBase: Record<string, number> = {};
  const clientBase: Record<string, number> = {};

  return {
    profile: DEMO_PROFILE,
    router: routerApi,
    mihomo,
    ufi: ufiApi,
    plugin,
    tick() {
      const s = w.speed;
      s.down = clamp(s.down + (Math.random() - 0.48) * 1.4 * MB, 0.4 * MB, 7.6 * MB);
      s.up = clamp(s.up + (Math.random() - 0.5) * 0.15 * MB, 0.05 * MB, 1.2 * MB);
      w.ufi.status.rate = { ...s };
      for (const c of w.connections) {
        const base = (connBase[c.id] ??= c.rate.down);
        c.rate.down = Math.max(KB, Math.round(base * (0.5 + Math.random())));
        c.rate.up = Math.round(c.rate.down * 0.08);
        c.download += c.rate.down * 2;
        c.upload += c.rate.up * 2;
      }
      for (const c of w.clients) c.rate.down = jitter((clientBase[c.mac] ??= c.rate.down), 0.15);
      const sig = w.ufi.status.signal;
      sig.rsrp = Math.round(clamp(sig.rsrp + (Math.random() - 0.5) * 4, -100, -75));
      sig.sinr = Math.round(clamp(sig.sinr + (Math.random() - 0.5) * 3, -2, 14));
    },
  };
}
