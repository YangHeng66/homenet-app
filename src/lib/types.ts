/*
 * 连接器接口。界面只依赖这里的类型；M1 在 src/lib/connectors/ 里实现真实连接器，
 * 演示模式由 src/lib/mock/ 实现同一套接口。
 *
 * 约定：
 * - 速率一律 字节/秒，流量一律 字节，时间戳一律 Unix 毫秒，延迟一律毫秒（null = 超时/未测）。
 * - 方法失败时抛 ConnectorError（见 errors.ts），不返回半成品。
 * - 会改动设备配置且可能断网的方法返回 Rollback，由界面显示回滚倒计时坞。
 */

export type Millis = number;
export type Bytes = number;
export type BytesPerSec = number;
export type Latency = number | null;

export interface Rate {
  up: BytesPerSec;
  down: BytesPerSec;
}

/** 可回滚事务。confirm 之后才真正生效；超时不确认由设备端自动恢复。 */
export interface Rollback {
  id: string;
  /** 设备端自动恢复的剩余秒数 */
  timeout: number;
  /** 由 App 自动检测网络并确认时，检测在第几秒完成（不需要用户点“保留”） */
  autoConfirmAfter?: number;
  confirm(): Promise<void>;
  revert(): Promise<void>;
}

/* ───────────────────────── 配置 ───────────────────────── */

export interface Endpoint {
  /** 例如 http://192.168.1.1 或 http://192.168.1.1:9090 */
  url: string;
  username?: string;
  /** 密码、secret 只在内存里传递，持久化在 Keystore */
  secret?: string;
}

/** 重点线路：用户挑一个分组，告诉 App 期望的出口 IP 和核对地址。 */
export interface KeyLine {
  id: string;
  name: string;
  /** mihomo 分组名 */
  group: string;
  /** 期望出口 IP，留空表示只看可用性 */
  expectIp?: string;
  /** 通过该分组访问、返回出口 IP 的地址 */
  checkUrl?: string;
  /** 匹配到这些域名后缀的连接算作这条线路（用于“实时连接”筛选） */
  domains: string[];
}

export interface Profile {
  id: string;
  name: string;
  demo: boolean;
  router?: Endpoint;
  mihomo?: Endpoint & { kind: MihomoKind };
  ufi?: Endpoint;
  keyLines: KeyLine[];
  /** 用户确认过“填的是公网地址，明文 HTTP 密码会被看到” */
  allowPublic?: boolean;
}

/* ───────────────────────── mihomo ───────────────────────── */

export type MihomoKind = 'nikki' | 'openclash' | 'mihomo';
export type ProxyMode = 'rule' | 'global' | 'direct';
export type GroupType = 'Selector' | 'Fallback' | 'URLTest' | 'LoadBalance' | 'Relay';

export interface ProxyNode {
  name: string;
  /** 协议，例如 Hysteria2 / Vless / Shadowsocks / Direct；分组作为成员时为分组类型 */
  type: string;
  /** 地区代码，界面显示用；拿不到时为 undefined */
  region?: string;
  udp?: boolean;
  alive: boolean;
  /** 最近一次测速 */
  delay: Latency;
}

export interface ProxyGroup {
  name: string;
  type: GroupType;
  /** 当前选中的成员 */
  now: string;
  /** 成员名，按配置顺序（fallback 的顺序就是切换顺序） */
  all: string[];
  hidden?: boolean;
  /** 用于测速的地址 */
  testUrl?: string;
}

export interface ProxySnapshot {
  groups: ProxyGroup[];
  /** 所有节点和分组，按名字索引 */
  nodes: Record<string, ProxyNode>;
}

export interface MihomoConnection {
  id: string;
  host: string;
  /** 目标 IP:端口，没有域名时显示 */
  destination: string;
  network: 'tcp' | 'udp';
  /** 来源 IP，界面再用路由器的在线设备表换成设备名 */
  sourceIp: string;
  /** 由外到内的代理链，例如 ["HomeB-08", "家宽 B", "节点选择"]，与 mihomo 返回顺序一致 */
  chains: string[];
  rule: string;
  rulePayload: string;
  upload: Bytes;
  download: Bytes;
  /** 由连续两次快照计算出的即时速率 */
  rate: Rate;
  start: Millis;
}

export interface ConnectionsSnapshot {
  uploadTotal: Bytes;
  downloadTotal: Bytes;
  connections: MihomoConnection[];
  /** 内核内存占用 */
  memory?: Bytes;
}

export interface SubscriptionInfo {
  upload: Bytes;
  download: Bytes;
  total: Bytes;
  /** 到期时间，0 = 不限 */
  expire: Millis;
}

export interface ProxyProvider {
  name: string;
  vehicleType: 'HTTP' | 'File' | 'Inline' | 'Compatible';
  nodeCount: number;
  updatedAt: Millis;
  subscription?: SubscriptionInfo;
}

export type RuleType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'DOMAIN-REGEX'
  | 'GEOSITE'
  | 'GEOIP'
  | 'IP-CIDR'
  | 'IP-CIDR6'
  | 'RULE-SET'
  | 'SRC-IP-CIDR'
  | 'PROCESS-NAME'
  | 'MATCH'
  | (string & {});

export interface Rule {
  type: RuleType;
  payload: string;
  /** 目标分组或 DIRECT / REJECT */
  proxy: string;
}

export interface MihomoVersion {
  version: string;
  meta: boolean;
}

export interface MihomoConnector {
  version(): Promise<MihomoVersion>;
  getMode(): Promise<ProxyMode>;
  setMode(mode: ProxyMode): Promise<void>;

  getProxies(): Promise<ProxySnapshot>;
  select(group: string, member: string): Promise<void>;
  /** 对整个分组测速，返回 成员名 → 延迟 */
  testGroup(group: string, url?: string, timeoutMs?: number): Promise<Record<string, Latency>>;
  testNode(name: string, url?: string, timeoutMs?: number): Promise<Latency>;

  /** 当前总速率（mihomo /traffic 的一次采样） */
  traffic(): Promise<Rate>;
  getConnections(): Promise<ConnectionsSnapshot>;
  closeConnection(id: string): Promise<void>;
  closeAllConnections(): Promise<void>;

  getProviders(): Promise<ProxyProvider[]>;
  updateProvider(name: string): Promise<void>;

  getRules(): Promise<Rule[]>;
  /** 通过指定分组请求 checkUrl，返回出口 IP 和地理信息 */
  checkExit(group: string, checkUrl: string): Promise<ExitInfo>;
}

export interface ExitInfo {
  ip: string;
  /** 例如 US·TX */
  region?: string;
  city?: string;
  isp?: string;
  residential?: boolean;
  checkedAt: Millis;
}

/* ───────────────────────── OpenWrt（rpcd） ───────────────────────── */

export interface RouterBoard {
  model: string;
  hostname: string;
  /** 例如 OpenWrt 25.12.6 */
  release: string;
  kernel: string;
  target: string;
}

export interface RouterStatus {
  uptime: number;
  /** 0–100 */
  cpu: number;
  /** 0–100 */
  memory: number;
  memTotal: Bytes;
  /** 摄氏度，设备没有温度传感器时为 undefined */
  temperature?: number;
  load: [number, number, number];
  wan: WanStatus;
  lanIp: string;
}

export interface WanStatus {
  up: boolean;
  /** 已连续在线秒数 */
  uptime: number;
  device: string;
  ipv4?: string;
  ipv6?: string;
  /** 协商速率，例如 1000 */
  speedMbps?: number;
  rate: Rate;
}

export type WifiBand = '2g' | '5g' | '6g';

export interface WifiRadio {
  /** uci 里的 radio 名，例如 radio1 */
  id: string;
  band: WifiBand;
  up: boolean;
  ssid: string;
  /** 'auto' 或信道号 */
  channel: string;
  channels: string[];
  htmode: string;
  clients: number;
}

export type LinkType = 'wired' | WifiBand;

export interface RouterClient {
  mac: string;
  ip: string;
  name: string;
  /** 设备类型猜测，只影响图标 */
  kind: 'phone' | 'pc' | 'tv' | 'other';
  link: LinkType;
  /** Wi-Fi 信号 dBm；有线为 undefined */
  signal?: number;
  /** 有线协商速率 */
  linkSpeedMbps?: number;
  rate: Rate;
  todayBytes?: Bytes;
  /** 连接器能认出是这台手机时为 true */
  isSelf?: boolean;
  /** DHCP 固定分配 */
  staticLease: boolean;
  online: boolean;
}

export interface OpenWrtRpcConnector {
  login(username: string, password: string): Promise<void>;
  /** 会话剩余秒数，未登录为 0 */
  sessionTtl(): Promise<number>;
  logout(): Promise<void>;

  board(): Promise<RouterBoard>;
  status(): Promise<RouterStatus>;
  clients(): Promise<RouterClient[]>;
  setStaticLease(mac: string, ip: string | null, name?: string): Promise<void>;
  renameClient(mac: string, name: string): Promise<void>;

  wifi(): Promise<WifiRadio[]>;
  /** 走 uci apply rollback，确认前设备端会自动恢复 */
  setWifiEnabled(radio: string, on: boolean): Promise<Rollback>;
  setWifiChannel(radio: string, channel: string): Promise<Rollback>;

  /** 读 uci 找 nikki / OpenClash 的控制接口地址和 secret */
  detectMihomo(): Promise<(Endpoint & { kind: MihomoKind }) | null>;
  serviceAction(name: string, action: 'start' | 'stop' | 'restart'): Promise<void>;
  serviceRunning(name: string): Promise<boolean>;
  /** WAN 口 down/up */
  resetWan(): Promise<void>;
  restartNetwork(): Promise<void>;
  reboot(): Promise<void>;
  /** sysupgrade -b，返回文件名 */
  backup(): Promise<string>;
}

/* ───────────────────────── F50（UFI-TOOLS） ───────────────────────── */

export type Rat = 'auto' | 'sa' | 'nsa' | 'lte';
export type UsbMode = 'auto' | 'rndis' | 'ecm';
/** F50 的热点只能 2.4G 和 5G 二选一（UFI-TOOLS 的 switchWiFiChip） */
export type UfiWifiBand = '2.4' | '5';
/** 真实连接器暂时做不到的操作（接口待抓包），值是给用户看的原因 */
export type UfiLimit = 'airplane' | 'hidden' | 'fotaUnblock' | 'speedTest';

export interface BandLock {
  /** 例如 ["n41"]，空数组表示该制式不锁 */
  nr: string[];
  /** 例如 ["B39"] */
  lte: string[];
}

export interface UfiSignal {
  /** 例如 5G SA / 5G NSA / 4G */
  network: string;
  operator: string;
  /** 当前驻留的频段，例如 ["n41", "B39"] */
  bands: string[];
  rsrp: number;
  rsrq: number;
  sinr: number;
  pci: number;
  /** 0–4 格 */
  bars: number;
}

export interface UfiTemps {
  board: number;
  soc: number;
  modem: number;
  pa: number;
  /** 设备开始降速的温度 */
  throttleAt: number;
}

export interface UfiStatus {
  model: string;
  firmware: string;
  ufiVersion: string;
  uptime: number;
  signal: UfiSignal;
  temps: UfiTemps;
  rate: Rate;
  dataOn: boolean;
  /** IPv4 / IPv4v6 */
  pdp: string;
  roaming: boolean;
  /** 读不到时不返回（UFI-TOOLS 没有读接口） */
  airplane?: boolean;
  monthBytes: Bytes;
  todayBytes: Bytes;
}

export interface UfiWifi {
  on: boolean;
  ssid: string;
  band: UfiWifiBand;
  hidden: boolean;
  clients: number;
}

export interface UfiDeviceToggles {
  led: boolean;
  adb: boolean;
  /** 拦截 FOTA 系统更新；读不到时不返回 */
  fotaBlock?: boolean;
}

export interface Sms {
  id: string;
  from: string;
  text: string;
  time: Millis;
  read: boolean;
}

export interface UfiConnector {
  /** 暂不支持的操作及原因；界面据此禁用控件并说明 */
  readonly limits?: Partial<Record<UfiLimit, string>>;
  login(password: string): Promise<void>;
  status(): Promise<UfiStatus>;

  bands(): Promise<{ current: BandLock; supported: BandLock }>;
  /** 锁频；未装路由器插件时由 App 在路由器上起一次性看门狗，否则返回的 Rollback 不会自动恢复 */
  lockBands(lock: BandLock): Promise<Rollback>;

  wifi(): Promise<UfiWifi>;
  setWifi(patch: Partial<Pick<UfiWifi, 'on' | 'band' | 'hidden'>>): Promise<void>;

  usbMode(): Promise<UsbMode>;
  setUsbMode(mode: UsbMode): Promise<void>;

  rat(): Promise<Rat>;
  setRat(rat: Rat): Promise<Rollback>;
  setData(on: boolean): Promise<Rollback | void>;
  setRoaming(on: boolean): Promise<void>;
  setAirplane(on: boolean): Promise<Rollback | void>;
  redial(): Promise<void>;

  toggles(): Promise<UfiDeviceToggles>;
  setToggle(key: keyof UfiDeviceToggles, on: boolean): Promise<void>;

  sms(): Promise<Sms[]>;
  /** 测一次带宽，单位 bit/s */
  speedTest(): Promise<{ down: number; up: number }>;
  reboot(): Promise<void>;
}

/* ───────────────────────── 路由器插件（可选，M3） ───────────────────────── */

export type ClientPolicy = 'rule' | 'direct' | 'proxy';
export type PluginFeature =
  | 'client-policy'
  | 'client-limit'
  | 'client-block'
  | 'my-rules'
  | 'alerts'
  | 'tasks'
  | 'usage'
  | 'backup'
  | 'wan-watchdog'
  | 'eee'
  | 'router-led'
  | 'ssh-lan-only'
  | 'scenes'
  | 'traffic-top'
  | 'log';

export interface ClientControl {
  mac: string;
  policy: ClientPolicy;
  /** Mbps，0 = 不限 */
  limitMbps: number;
  blocked: boolean;
  /** 今天常去的域名 */
  topDomains: { domain: string; bytes: Bytes }[];
}

export interface MyRule {
  /** DOMAIN-SUFFIX 的后缀 */
  domain: string;
  /** 目标分组名或 DIRECT */
  target: string;
  addedAt: Millis;
}

export type AlertLevel = 'ok' | 'warn' | 'bad';

export interface AlertItem {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  time: Millis;
  unread: boolean;
}

export interface AlertThresholds {
  /** F50 温度 ℃ */
  temp: number;
  /** 月流量用到套餐的百分比 */
  quota: number;
  /** WAN 每小时断开次数 */
  wan: number;
  /** 重点线路出口变化时提醒 */
  keyLineExit: boolean;
}

export type TaskIcon = 'sync' | 'moon' | 'power' | 'gauge' | 'cell' | 'spark' | 'leaf';

export interface ScheduledTask {
  id: string;
  name: string;
  /** 人类可读的时间描述 */
  schedule: string;
  /** cron 表达式 */
  cron: string;
  next?: Millis;
  icon: TaskIcon;
  enabled: boolean;
}

export interface UsageMonth {
  /** 本月每天的用量，下标 0 = 1 号 */
  daily: Bytes[];
  quota: Bytes;
  /** 每月几号重置 */
  resetDay: number;
}

export interface BackupItem {
  id: string;
  name: string;
  time: Millis;
  size: Bytes;
  auto: boolean;
}

export type LogStatus = 'ok' | 'rb' | 'err';

export interface LogEntry {
  time: Millis;
  status: LogStatus;
  action: string;
  detail: string;
}

export interface Scene {
  id: string;
  name: string;
  /** 两行说明，用 \n 分隔 */
  desc: string;
  icon: 'home' | 'spark' | 'bolt' | 'leaf' | 'warn';
  hazard: boolean;
  /** 切换时要做的事，用于确认面板 */
  steps: ImpactLine[];
}

export interface PortSettings {
  wanWatchdog: boolean;
  /** 今天看门狗重置次数 */
  watchdogResetsToday: number;
  eeeOff: boolean;
  led: boolean;
  sshLanOnly: boolean;
}

export interface PluginConnector {
  version(): Promise<string>;
  features(): Promise<PluginFeature[]>;

  clientControls(): Promise<ClientControl[]>;
  setClientPolicy(mac: string, policy: ClientPolicy): Promise<void>;
  setClientLimit(mac: string, mbps: number): Promise<void>;
  /** 暂停上网；本机被暂停时返回带自动恢复的 Rollback */
  setClientBlocked(mac: string, blocked: boolean): Promise<Rollback | void>;

  myRules(): Promise<MyRule[]>;
  addMyRule(domain: string, target: string): Promise<void>;
  removeMyRule(domain: string): Promise<void>;

  alerts(): Promise<AlertItem[]>;
  markAlertsRead(): Promise<void>;
  thresholds(): Promise<AlertThresholds>;
  setThresholds(patch: Partial<AlertThresholds>): Promise<void>;

  tasks(): Promise<ScheduledTask[]>;
  setTaskEnabled(id: string, on: boolean): Promise<void>;
  addTask(task: Omit<ScheduledTask, 'id' | 'next'>): Promise<ScheduledTask>;

  usage(): Promise<UsageMonth>;
  setQuota(quota: Bytes, resetDay: number): Promise<void>;

  /** 今天的流量排行；via 是走的分组链，例如 “YouTube → 家宽 B” */
  trafficTop(by: 'domain' | 'device'): Promise<{ name: string; bytes: Bytes; via: string }[]>;

  /** 过去 24 小时 WAN 断开的时间点 */
  wanEvents(): Promise<Millis[]>;
  ports(): Promise<PortSettings>;
  setPort(key: Exclude<keyof PortSettings, 'watchdogResetsToday'>, on: boolean): Promise<void>;

  backups(): Promise<BackupItem[]>;
  restore(id: string): Promise<void>;

  scenes(): Promise<{ list: Scene[]; active: string }>;
  applyScene(id: string): Promise<void>;

  log(): Promise<LogEntry[]>;
  addLog(entry: Omit<LogEntry, 'time'>): Promise<void>;
}

/* ───────────────────────── 汇总 ───────────────────────── */

/** 确认面板里一行影响说明：w 警告、r 会自动恢复、x 严重、i 说明 */
export type ImpactKind = 'w' | 'r' | 'x' | 'i';
export type ImpactLine = [ImpactKind, string];

/** 一套配置连上后可用的连接器。没检测到的模块为 undefined，界面整块隐藏。 */
export interface Connectors {
  profile: Profile;
  router?: OpenWrtRpcConnector;
  mihomo?: MihomoConnector;
  ufi?: UfiConnector;
  plugin?: PluginConnector;
}

/** 演示模式：同一套接口，数据来自内存，不发任何网络请求。 */
export interface MockConnectors extends Connectors {
  router: OpenWrtRpcConnector;
  mihomo: MihomoConnector;
  ufi: UfiConnector;
  plugin: PluginConnector;
  /** 让假数据前进一拍（网速、连接速率、信号随机游走） */
  tick(): void;
}
