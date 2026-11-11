/*
 * OpenWrt 连接器：POST /ubus 的 JSON-RPC（uhttpd-mod-ubus + rpcd），免安装。
 * 需要路由器上有 rpcd-mod-file、rpcd-mod-iwinfo、rpcd-mod-rc（装了 LuCI 就都有），用 root 或等效权限的账号登录。
 * uci apply / confirm / rollback 的语义以 rpcd 的 uci.c 为准，就是 LuCI “保存并应用”的倒计时。
 */
import { ConnectorError } from '../errors';
import type {
  Endpoint, LinkType, MihomoKind, OpenWrtRpcConnector, Rate, Rollback, RouterClient, WifiBand, WifiRadio,
} from '../types';
import type { Http } from './http';

export interface OpenWrtOptions {
  now?: () => number;
  /** 改 Wi-Fi 后等待确认的秒数，超时由路由器自己回滚。90 是 LuCI 的默认值 */
  rollbackTimeout?: number;
}

const NO_SID = '0'.repeat(32);
/** uhttpd-mod-ubus 在会话无效或 ACL 不允许时返回的 JSON-RPC 错误码 */
const RPC_ACCESS_DENIED = -32002;
const DENIED = 6;
const UBUS_STATUS: Record<number, string> = {
  1: '无效命令', 2: '参数不对', 3: '没有这个方法', 4: '找不到', 5: '没有数据', 6: '拒绝访问', 7: '超时', 8: '不支持', 9: '未知错误', 10: '连接失败',
};

interface Call {
  object: string;
  method: string;
  args?: Record<string, unknown>;
}
interface Result {
  /** ubus 状态码；-1 表示响应不成形 */
  code: number;
  /** 会话无效（要重新登录），区别于对象自己返回的“拒绝访问” */
  expired: boolean;
  data: any;
}

interface UciSection { '.type': string; '.name': string; [k: string]: unknown }
interface Iface {
  interface: string; up?: boolean; uptime?: number; device?: string; l3_device?: string;
  'ipv4-address'?: { address: string }[]; 'ipv6-address'?: { address: string }[];
}
interface Radio {
  id: string; band: WifiBand; up: boolean; channel: string; htmode: string; ssid: string; ifnames: string[];
}

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,32}$/;
const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const isIPv4 = (s: string) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every(n => +n <= 255);
const bad = (what: string) => new ConnectorError('device', `参数不合法：${what}`);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : []);

function guessKind(name: string): RouterClient['kind'] {
  if (/iphone|ipad|android|pixel|galaxy|phone|huawei|honor|xiaomi|redmi|oppo|vivo|oneplus|mate|nova/i.test(name)) return 'phone';
  if (/tv|box|chromecast|roku|shield|projector/i.test(name)) return 'tv';
  if (/pc|desktop|laptop|macbook|imac|thinkpad|nuc|nas|win/i.test(name)) return 'pc';
  return 'other';
}

export function createOpenWrt(endpoint: Endpoint, http: Http, opts: OpenWrtOptions = {}): OpenWrtRpcConnector {
  const base = endpoint.url.replace(/\/+$/, '');
  const now = opts.now ?? Date.now;
  const rollbackTimeout = opts.rollbackTimeout ?? 90;

  let sid = NO_SID;
  let creds = endpoint.username && endpoint.secret ? { username: endpoint.username, password: endpoint.secret } : null;
  let seq = 0;
  let loggingIn: Promise<void> | null = null;
  let prevCpu: { total: number; idle: number } | null = null;
  let prevWan: { dev: string; at: number; rx: number; tx: number; rate: Rate } | null = null;

  async function rpc(calls: Call[], session = sid): Promise<Result[]> {
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'call', params: [session, c.object, c.method, c.args ?? {}] }));
    const r = await http({ url: `${base}/ubus`, method: 'POST', body: body.length === 1 ? body[0] : body });
    const replies: any[] = Array.isArray(r.data) ? r.data : [r.data];
    return calls.map((_, i) => {
      const m = replies.find(x => x?.id === i + 1);
      if (m?.error) return { code: m.error.code === RPC_ACCESS_DENIED ? DENIED : -1, expired: m.error.code === RPC_ACCESS_DENIED, data: undefined };
      if (!Array.isArray(m?.result)) return { code: -1, expired: false, data: undefined };
      return { code: m.result[0], expired: false, data: m.result[1] ?? {} };
    });
  }

  /** 同时有好几个请求撞上会话过期时只登录一次 */
  function doLogin(): Promise<void> {
    return (loggingIn ??= loginOnce().finally(() => { loggingIn = null; }));
  }

  async function loginOnce() {
    const [r] = await rpc([{ object: 'session', method: 'login', args: { ...creds } }], NO_SID);
    if (r.code !== 0 || !r.data?.ubus_rpc_session) {
      sid = NO_SID;
      throw new ConnectorError('auth', r.code === DENIED ? '路由器用户名或密码不对' : `路由器登录失败（${UBUS_STATUS[r.code] ?? r.code}）`);
    }
    sid = r.data.ubus_rpc_session;
  }

  /** 批量调用，一次 HTTP 请求。会话过期时重新登录一次再整批重试 */
  async function batch(calls: Call[], relogin = true): Promise<Result[]> {
    if (!calls.length) return [];
    let res = await rpc(calls);
    if (relogin && creds && res.some(r => r.expired)) {
      await doLogin();
      res = await rpc(calls);
    }
    return res;
  }

  function fail(c: Call, r: Result): ConnectorError {
    if (r.code === DENIED) return new ConnectorError('auth', r.expired ? '路由器会话已失效，请重新登录' : `路由器拒绝了 ${c.object} ${c.method}（权限不够，或有别的改动正在等待确认）`);
    return new ConnectorError('device', `${c.object} ${c.method} 失败（${UBUS_STATUS[r.code] ?? '响应不成形'}）`);
  }

  async function call<T = any>(object: string, method: string, args?: Record<string, unknown>, relogin = true): Promise<T> {
    const c = { object, method, args };
    const [r] = await batch([c], relogin);
    if (r.code !== 0) throw fail(c, r);
    return r.data;
  }

  /** 可选数据：失败的项为 null。只有全都因为会话无效失败时才抛错 */
  async function tryBatch(calls: Call[]): Promise<any[]> {
    const res = await batch(calls);
    if (res.length && res.every(r => r.expired)) throw fail(calls[0], res[0]);
    return res.map(r => (r.code === 0 ? r.data : null));
  }

  /** 发出去之后路由器会断网或重启，收不到回应是正常的 */
  async function fireAndForget(object: string, method: string) {
    try {
      await call(object, method);
    } catch (e) {
      if (!(e instanceof ConnectorError) || (e.kind !== 'network' && e.kind !== 'timeout')) throw e;
    }
  }

  async function applyNow() {
    await call('uci', 'apply', { rollback: false });
  }

  async function wireless(withChannels: boolean, known?: Record<string, any> | null): Promise<{ radios: Radio[]; assoc: Record<string, { mac: string; signal?: number }[]>; channels: Record<string, string[]> }> {
    const status: Record<string, any> = known ?? await call('network.wireless', 'status');
    const radios: Radio[] = Object.entries(status).map(([id, st]) => {
      const aps = (st.interfaces ?? []) as { ifname?: string; config?: { ssid?: string } }[];
      return {
        id, band: (st.config?.band ?? '2g') as WifiBand, up: !!st.up && !st.disabled,
        channel: String(st.config?.channel ?? 'auto'), htmode: String(st.config?.htmode ?? ''),
        ssid: aps[0]?.config?.ssid ?? '', ifnames: aps.map(a => a.ifname).filter((n): n is string => !!n),
      };
    });
    const ifnames = radios.flatMap(r => r.ifnames);
    const extra = await tryBatch([
      ...ifnames.map(device => ({ object: 'iwinfo', method: 'assoclist', args: { device } })),
      ...(withChannels ? radios.map(r => ({ object: 'iwinfo', method: 'freqlist', args: { device: r.id } })) : []),
    ]);
    const assoc = Object.fromEntries(ifnames.map((n, i) => [n, extra[i]?.results ?? []]));
    const channels = Object.fromEntries(radios.map((r, i) => {
      const free = ((extra[ifnames.length + i]?.results ?? []) as { channel: number; restricted?: boolean }[]).filter(f => !f.restricted);
      return [r.id, ['auto', ...free.map(f => String(f.channel))]];
    }));
    return { radios, assoc, channels };
  }

  async function applyWireless(radio: string, values: Record<string, string>): Promise<Rollback> {
    if (!NAME_RE.test(radio)) throw bad('射频名');
    const cur = await call<{ values?: UciSection }>('uci', 'get', { config: 'wireless', section: radio });
    if (cur.values?.['.type'] !== 'wifi-device') throw new ConnectorError('device', `没有这个射频：${radio}`);
    await call('uci', 'set', { config: 'wireless', section: radio, values });
    try {
      await call('uci', 'apply', { rollback: true, timeout: rollbackTimeout });
    } catch (e) {
      await call('uci', 'revert', { config: 'wireless' }).catch(() => {});
      throw e;
    }
    // rpcd 只认发起 apply 的那个会话，所以确认和回滚都不能重新登录后重试
    return {
      id: `uci-${++seq}`,
      timeout: rollbackTimeout,
      async confirm() { await call('uci', 'confirm', {}, false); },
      async revert() { await call('uci', 'rollback', {}, false); },
    };
  }

  async function findHost(mac: string): Promise<UciSection | undefined> {
    const r = await call<{ values?: Record<string, UciSection> }>('uci', 'get', { config: 'dhcp', type: 'host' });
    return Object.values(r.values ?? {}).find(s => list(s.mac).some(m => m.toUpperCase() === mac));
  }

  function normMac(mac: string): string {
    const m = mac.trim().toUpperCase();
    if (!MAC_RE.test(m)) throw bad('MAC 地址');
    return m;
  }

  return {
    async login(username, password) {
      creds = { username, password };
      try {
        await doLogin();
      } catch (e) {
        creds = null;
        throw e;
      }
    },

    async sessionTtl() {
      if (sid === NO_SID) return 0;
      const [r] = await batch([{ object: 'session', method: 'list' }], false);
      return r.code === 0 ? Number(r.data.expires) || 0 : 0;
    },

    async logout() {
      if (sid !== NO_SID) await batch([{ object: 'session', method: 'destroy' }], false);
      sid = NO_SID;
      creds = null;
    },

    async board() {
      const b = await call('system', 'board');
      const rel = b.release ?? {};
      return {
        model: b.model ?? '', hostname: b.hostname ?? '', kernel: b.kernel ?? '', target: rel.target ?? '',
        release: rel.distribution && rel.version ? `${rel.distribution} ${rel.version}` : rel.description ?? '',
      };
    },

    async status() {
      const [info, dump, devs, stat, temp] = await tryBatch([
        { object: 'system', method: 'info' },
        { object: 'network.interface', method: 'dump' },
        { object: 'network.device', method: 'status' },
        { object: 'file', method: 'read', args: { path: '/proc/stat' } },
        { object: 'file', method: 'read', args: { path: '/sys/class/thermal/thermal_zone0/temp' } },
      ]);
      if (!info) throw new ConnectorError('device', '读不到路由器状态（system info）');
      const at = now();

      // /proc/stat 第一行：user nice system idle iowait irq softirq steal…，第一次没有上一拍时用开机以来的平均值
      const n = String(stat?.data ?? '').split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number);
      const cur = { total: n.reduce((a, b) => a + (b || 0), 0), idle: (n[3] || 0) + (n[4] || 0) };
      const dTotal = cur.total - (prevCpu?.total ?? 0), dIdle = cur.idle - (prevCpu?.idle ?? 0);
      const cpu = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0;
      prevCpu = cur;

      const ifaces: Iface[] = dump?.interface ?? [];
      const wan = ifaces.find(i => i.interface === 'wan');
      const wan6 = ifaces.find(i => i.interface === 'wan6');
      const lan = ifaces.find(i => i.interface === 'lan');
      const device = wan?.l3_device ?? wan?.device ?? '';
      const dev = devs?.[device];
      const rx = Number(dev?.statistics?.rx_bytes ?? 0), tx = Number(dev?.statistics?.tx_bytes ?? 0);
      let rate: Rate = { up: 0, down: 0 };
      const p = prevWan;
      const dt = p ? (at - p.at) / 1000 : 0;
      if (p && p.dev === device && dt < 0.5) rate = p.rate;
      else if (p && p.dev === device && rx >= p.rx && tx >= p.tx) rate = { down: (rx - p.rx) / dt, up: (tx - p.tx) / dt };
      prevWan = { dev: device, at, rx, tx, rate };

      const mem = info.memory ?? {};
      const total = Number(mem.total) || 0;
      const speed = parseInt(dev?.speed ?? '', 10);
      const celsius = Number(String(temp?.data ?? '').trim());
      return {
        uptime: info.uptime ?? 0,
        cpu,
        memory: total ? Math.round((1 - (mem.available ?? mem.free ?? 0) / total) * 100) : 0,
        memTotal: total,
        temperature: temp && Number.isFinite(celsius) ? Math.round(celsius / 100) / 10 : undefined,
        load: (info.load ?? [0, 0, 0]).map((l: number) => Math.round((l / 65536) * 100) / 100) as [number, number, number],
        wan: {
          up: !!wan?.up,
          uptime: wan?.uptime ?? 0,
          device,
          ipv4: wan?.['ipv4-address']?.[0]?.address,
          ipv6: [...(wan6?.['ipv6-address'] ?? []), ...(wan?.['ipv6-address'] ?? [])].map(a => a.address).find(a => !/^fe80/i.test(a)),
          speedMbps: speed > 0 ? speed : undefined,
          rate: { ...rate },
        },
        lanIp: lan?.['ipv4-address']?.[0]?.address ?? '',
      };
    },

    async clients() {
      const [leaseFile, hosts, dump, neigh, wifiStatus] = await tryBatch([
        { object: 'file', method: 'read', args: { path: '/tmp/dhcp.leases' } },
        { object: 'uci', method: 'get', args: { config: 'dhcp', type: 'host' } },
        { object: 'network.interface', method: 'dump' },
        { object: 'file', method: 'exec', args: { command: '/sbin/ip', params: ['-4', 'neigh', 'show'] } },
        { object: 'network.wireless', method: 'status' },
      ]);
      const { radios, assoc } = await wireless(false, wifiStatus ?? {});
      const nowSec = now() / 1000;

      interface Seen { ip?: string; name?: string; expires?: number; fixed?: boolean; band?: WifiBand; signal?: number; neigh?: string }
      const seen = new Map<string, Seen>();
      const at = (mac: string): Seen => {
        const k = mac.toUpperCase();
        if (!seen.has(k)) seen.set(k, {});
        return seen.get(k)!;
      };

      // dnsmasq 租约文件每行：过期时间 MAC IP 主机名 client-id，没有主机名时是 *
      for (const line of String(leaseFile?.data ?? '').split('\n')) {
        const [expires, mac, ip, name] = line.trim().split(/\s+/);
        if (!mac || !ip) continue;
        Object.assign(at(mac), { ip, expires: Number(expires), name: name && name !== '*' ? name : undefined });
      }
      for (const h of Object.values((hosts?.values ?? {}) as Record<string, UciSection>)) {
        for (const mac of list(h.mac)) {
          const s = at(mac);
          if (typeof h.name === 'string') s.name = h.name;
          if (typeof h.ip === 'string') { s.fixed = true; s.ip ??= h.ip; }
        }
      }
      for (const r of radios) {
        for (const ifname of r.ifnames) for (const a of assoc[ifname]) Object.assign(at(a.mac), { band: r.band, signal: a.signal });
      }
      const lanDev = ((dump?.interface ?? []) as Iface[]).find(i => i.interface === 'lan')?.l3_device ?? 'br-lan';
      const haveNeigh = neigh?.code === 0;
      for (const line of String(neigh?.stdout ?? '').split('\n')) {
        const m = /^(\S+) dev (\S+)(?: lladdr (\S+))?.* (\S+)$/.exec(line.trim());
        if (!m || m[2] !== lanDev || !m[3]) continue;
        const known = seen.has(m[3].toUpperCase());
        const alive = /^(REACHABLE|STALE|DELAY|PROBE|PERMANENT)$/.test(m[4]);
        if (!known && !alive) continue;
        const s = at(m[3]);
        s.ip ??= m[1];
        s.neigh = m[4];
        if (!alive) s.neigh = 'down';
      }

      return [...seen].map(([mac, s]): RouterClient => {
        const link: LinkType = s.band ?? 'wired';
        const online = s.band ? true : haveNeigh ? !!s.neigh && s.neigh !== 'down' : (s.expires ?? 0) > nowSec;
        const name = s.name ?? s.ip ?? mac;
        return { mac, ip: s.ip ?? '', name, kind: guessKind(name), link, signal: s.signal, rate: { up: 0, down: 0 }, staticLease: !!s.fixed, online };
      });
    },

    async setStaticLease(mac, ip, name) {
      const m = normMac(mac);
      if (ip !== null && !isIPv4(ip)) throw bad('IP 地址');
      if (name !== undefined && !HOSTNAME_RE.test(name)) throw bad('主机名');
      const host = await findHost(m);
      if (ip === null) {
        if (!host) return;
        await call('uci', 'delete', host.name ? { config: 'dhcp', section: host['.name'], option: 'ip' } : { config: 'dhcp', section: host['.name'] });
      } else if (host) {
        await call('uci', 'set', { config: 'dhcp', section: host['.name'], values: name ? { ip, name } : { ip } });
      } else {
        await call('uci', 'add', { config: 'dhcp', type: 'host', values: name ? { mac: m, ip, name } : { mac: m, ip } });
      }
      await applyNow();
    },

    async renameClient(mac, name) {
      const m = normMac(mac);
      // 名字写进 dnsmasq 的 DHCP 主机名，只能是合法主机名；中文备注要等路由器插件（M3）
      if (!HOSTNAME_RE.test(name)) throw new ConnectorError('unsupported', '不装插件时名字只能用字母、数字和连字符（它会成为设备的主机名）');
      const host = await findHost(m);
      if (host) await call('uci', 'set', { config: 'dhcp', section: host['.name'], values: { name } });
      else await call('uci', 'add', { config: 'dhcp', type: 'host', values: { mac: m, name } });
      await applyNow();
    },

    async wifi() {
      const { radios, assoc, channels } = await wireless(true);
      return radios.map((r): WifiRadio => ({
        id: r.id, band: r.band, up: r.up, ssid: r.ssid, channel: r.channel, channels: channels[r.id], htmode: r.htmode,
        clients: r.ifnames.reduce((n, i) => n + assoc[i].length, 0),
      }));
    },

    setWifiEnabled(radio, on) {
      return applyWireless(radio, { disabled: on ? '0' : '1' });
    },

    async setWifiChannel(radio, channel) {
      if (!/^(auto|\d{1,3})$/.test(channel)) throw bad('信道');
      return applyWireless(radio, { channel });
    },

    async detectMihomo() {
      const [nikki, openclash] = await tryBatch([
        { object: 'uci', method: 'get', args: { config: 'nikki' } },
        { object: 'uci', method: 'get', args: { config: 'openclash' } },
      ]);
      const host = new URL(base).hostname;
      const found: { enabled: boolean; ep: Endpoint & { kind: MihomoKind } }[] = [];
      const push = (kind: MihomoKind, enabled: boolean, port: string, secret: unknown) => {
        const ep: Endpoint & { kind: MihomoKind } = { url: `http://${host}:${port}`, kind };
        if (typeof secret === 'string' && secret) ep.secret = secret;
        found.push({ enabled, ep });
      };
      if (nikki?.values) {
        const v = nikki.values;
        push('nikki', v.config?.enabled === '1', /:(\d+)$/.exec(v.mixin?.api_listen ?? '')?.[1] ?? '9090', v.mixin?.api_secret);
      }
      if (openclash?.values) {
        const c = openclash.values.config ?? {};
        push('openclash', c.enable === '1', /^\d+$/.test(c.cn_port ?? '') ? c.cn_port : '9090', c.dashboard_password);
      }
      return (found.find(f => f.enabled) ?? found[0])?.ep ?? null;
    },

    async serviceAction(name, action) {
      if (!NAME_RE.test(name)) throw bad('服务名');
      await call('rc', 'init', { name, action });
    },

    async serviceRunning(name) {
      if (!NAME_RE.test(name)) throw bad('服务名');
      const r = await call('service', 'list', { name });
      return Object.values((r[name]?.instances ?? {}) as Record<string, { running?: boolean }>).some(i => i.running);
    },

    async resetWan() {
      await call('network.interface.wan', 'down');
      await call('network.interface.wan', 'up');
    },

    restartNetwork() {
      return fireAndForget('network', 'restart');
    },

    reboot() {
      return fireAndForget('system', 'reboot');
    },

    async backup() {
      const { hostname } = await call('system', 'board');
      const d = new Date(now());
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const file = `backup-${NAME_RE.test(hostname ?? '') ? hostname : 'openwrt'}-${date}.tar.gz`;
      const r = await call('file', 'exec', { command: '/sbin/sysupgrade', params: ['-b', `/tmp/${file}`] });
      if (r.code !== 0) throw new ConnectorError('device', `备份失败：${String(r.stderr ?? '').slice(0, 120) || `sysupgrade 返回 ${r.code}`}`);
      return file;
    },
  };
}
