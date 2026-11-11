/*
 * mihomo RESTful 控制接口（nikki / OpenClash / 独立 mihomo 都一样），Bearer secret。
 * 接口和字段以 MetaCubeX/Meta-Docs 的 api 文档和 mihomo 源码为准。
 */
import { ConnectorError } from '../errors';
import type {
  ConnectionsSnapshot, Endpoint, ExitInfo, GroupType, Latency, MihomoConnection, MihomoConnector, ProxyGroup,
  ProxyMode, ProxyNode, ProxyProvider, Rate, Rule,
} from '../types';
import type { Http, HttpMethod, HttpResponse } from './http';

export interface MihomoOptions {
  now?: () => number;
  /**
   * 出口核对的取数方式，返回 checkUrl 的响应正文。
   * 控制接口没有“经某个分组请求一个地址并返回正文”的能力，默认做法是手机自己请求 checkUrl：
   * 只有手机的流量经过这台 mihomo（连着家里 Wi-Fi），并且规则把 checkUrl 的域名分到该分组时结果才对。
   * 远程（Tailscale）使用时要换成在路由器上请求的实现，联调时定。
   */
  fetchExit?: (checkUrl: string, group: string) => Promise<string>;
}

const DELAY_URL = 'https://www.gstatic.com/generate_204';
/** 测速超时或节点出错时 mihomo 返回的状态码 */
const DELAY_FAILED = [408, 503, 504];
const PROVIDER_MAP_TTL = 600_000;

/** /rules 返回的类型名（mihomo constant/rule.go）→ 配置文件里的写法 */
const RULE_TYPES: Record<string, string> = {
  Domain: 'DOMAIN', DomainSuffix: 'DOMAIN-SUFFIX', DomainKeyword: 'DOMAIN-KEYWORD', DomainRegex: 'DOMAIN-REGEX',
  DomainWildcard: 'DOMAIN-WILDCARD', GeoSite: 'GEOSITE', GeoIP: 'GEOIP', SrcGeoIP: 'SRC-GEOIP', IPASN: 'IP-ASN',
  SrcIPASN: 'SRC-IP-ASN', IPCIDR: 'IP-CIDR', SrcIPCIDR: 'SRC-IP-CIDR', IPSuffix: 'IP-SUFFIX', SrcIPSuffix: 'SRC-IP-SUFFIX',
  SrcPort: 'SRC-PORT', DstPort: 'DST-PORT', InPort: 'IN-PORT', InUser: 'IN-USER', InName: 'IN-NAME', InType: 'IN-TYPE',
  ProcessName: 'PROCESS-NAME', ProcessPath: 'PROCESS-PATH', ProcessNameRegex: 'PROCESS-NAME-REGEX',
  ProcessPathRegex: 'PROCESS-PATH-REGEX', Match: 'MATCH', RuleSet: 'RULE-SET', Network: 'NETWORK', Uid: 'UID', SubRules: 'SUB-RULE',
};

interface RawProxy {
  name: string;
  type: string;
  udp?: boolean;
  alive?: boolean;
  history?: { delay: number }[];
  now?: string;
  all?: string[];
  hidden?: boolean;
  testUrl?: string;
}

interface RawProvider {
  name: string;
  vehicleType: ProxyProvider['vehicleType'];
  proxies?: RawProxy[];
  updatedAt?: string;
  subscriptionInfo?: { Upload?: number; Download?: number; Total?: number; Expire?: number };
}

interface RawConnections {
  uploadTotal: number;
  downloadTotal: number;
  memory?: number;
  connections: {
    id: string; upload: number; download: number; start: string; chains: string[]; rule: string; rulePayload: string;
    metadata: { network: string; sourceIP: string; destinationIP: string; destinationPort: string; host: string; sniffHost?: string };
  }[] | null;
}

const enc = encodeURIComponent;

/** 节点名里的国旗 emoji → 地区代码 */
function regionOf(name: string): string | undefined {
  const m = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u.exec(name);
  return m ? String.fromCharCode(m[1].codePointAt(0)! - 0x1f1e6 + 65, m[2].codePointAt(0)! - 0x1f1e6 + 65) : undefined;
}

/** Go 的时间戳带纳秒，统一截到毫秒再解析；零值（0001 年）算没有 */
function parseTime(s: string | undefined): number {
  const t = Date.parse((s ?? '').replace(/(\.\d{3})\d+/, '$1'));
  return t > 0 ? t : 0;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** 解析出口核对地址的响应：JSON（各家字段名不一样）、cdn-cgi/trace 的 key=value、或者只有一个 IP 的纯文本 */
export function parseExit(body: unknown): Omit<ExitInfo, 'checkedAt'> {
  let o = body;
  if (typeof o === 'string') {
    const text = o.trim();
    try { o = JSON.parse(text); } catch {
      const trace = Object.fromEntries(text.split('\n').map(l => l.split('=', 2)).filter(p => p.length === 2));
      o = trace.ip ? { ip: trace.ip, country_code: trace.loc } : { ip: text };
    }
  }
  const j = (o ?? {}) as Record<string, unknown>;
  const ip = str(j.ip) ?? str(j.query) ?? str(j.origin) ?? str(j.ip_addr);
  if (!ip || !/^[0-9a-fA-F.:]{3,45}$/.test(ip)) throw new ConnectorError('device', '核对地址没有返回出口 IP');

  const short = (v: unknown, max: number) => { const s = str(v); return s && s.length <= max ? s.toUpperCase() : undefined; };
  const country = short(j.country_code, 2) ?? short(j.countryCode, 2) ?? short(j.country, 2);
  const sub = short(j.region_code, 3) ?? short(j.regionCode, 3) ?? short(j.region, 3);
  const out: Omit<ExitInfo, 'checkedAt'> = { ip };
  if (country) out.region = sub ? `${country}·${sub}` : country;
  const city = str(j.city);
  if (city) out.city = city;
  const isp = str(j.isp) ?? str(j.org) ?? str(j.as_org) ?? str(j.asn_org);
  if (isp) out.isp = isp;
  if (typeof j.residential === 'boolean') out.residential = j.residential;
  return out;
}

export function createMihomo(endpoint: Endpoint, http: Http, opts: MihomoOptions = {}): MihomoConnector {
  const base = endpoint.url.replace(/\/+$/, '');
  const now = opts.now ?? Date.now;
  const auth: Record<string, string> = endpoint.secret ? { Authorization: `Bearer ${endpoint.secret}` } : {};

  const call = (method: HttpMethod, path: string, body?: object, extra?: { timeoutMs?: number; accept?: number[] }): Promise<HttpResponse> =>
    http({ url: base + path, method, headers: auth, body, ...extra });
  const get = async <T>(path: string, timeoutMs?: number) => (await call('GET', path, undefined, { timeoutMs })).data as T;

  /** 上次 getProxies 看到的分组：testGroup 要用成员表和测速地址 */
  let groupsSeen: Record<string, ProxyGroup> | null = null;
  let providerMap: { at: number; map: Record<string, string> } | null = null;
  let prevConns: { at: number; byId: Map<string, { up: number; down: number }> } | null = null;
  let prevTotals: { at: number; up: number; down: number; rate: Rate } | null = null;

  /**
   * proxy-provider 里的节点不一定出现在 /proxies 里，要到 provider 去查。
   * 整份 /providers/proxies 可能有 1 MB 以上，所以把“节点 → provider”缓存 10 分钟，平时只拉用到的那几个 provider。
   */
  async function fillFromProviders(all: Record<string, RawProxy>, missing: string[]) {
    const stale = !providerMap || now() - providerMap.at > PROVIDER_MAP_TTL || missing.some(n => !providerMap!.map[n]);
    if (stale) {
      const r = await get<{ providers?: Record<string, RawProvider> }>('/providers/proxies', 15_000);
      const map: Record<string, string> = {};
      for (const [pn, p] of Object.entries(r.providers ?? {})) {
        if (p.vehicleType === 'Compatible') continue;
        for (const x of p.proxies ?? []) { map[x.name] = pn; all[x.name] ??= x; }
      }
      providerMap = { at: now(), map };
      return;
    }
    const wanted = [...new Set(missing.map(n => providerMap!.map[n]))];
    await Promise.all(wanted.map(async pn => {
      const p = await get<RawProvider>(`/providers/proxies/${enc(pn)}`);
      for (const x of p.proxies ?? []) all[x.name] ??= x;
    }));
  }

  const delayOf = (v: unknown): Latency => (typeof v === 'number' && v > 0 ? v : null);

  const self: MihomoConnector = {
    async version() {
      const v = await get<{ version: string; meta?: boolean }>('/version');
      return { version: v.version, meta: !!v.meta };
    },

    async getMode() {
      const mode = String((await get<{ mode?: string }>('/configs')).mode ?? '').toLowerCase();
      return mode === 'global' || mode === 'direct' ? mode : 'rule';
    },

    async setMode(mode: ProxyMode) {
      await call('PATCH', '/configs', { mode });
    },

    async getProxies() {
      const all = { ...(await get<{ proxies: Record<string, RawProxy> }>('/proxies')).proxies };
      const raws = Object.values(all).filter(p => Array.isArray(p.all) && p.name !== 'GLOBAL');
      const missing = [...new Set(raws.flatMap(g => g.all!).filter(n => !all[n]))];
      if (missing.length) await fillFromProviders(all, missing);

      // /proxies 是按名字索引的对象，配置里的分组顺序只能从 GLOBAL 的成员表拿
      const order = all.GLOBAL?.all ?? [];
      const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
      raws.sort((a, b) => rank(a.name) - rank(b.name));

      const leaf = (p: RawProxy): RawProxy => {
        for (let guard = 0; guard < 8 && p.all && p.now && all[p.now]; guard++) p = all[p.now];
        return p;
      };
      const nodes: Record<string, ProxyNode> = {};
      for (const p of Object.values(all)) {
        if (p.name === 'GLOBAL') continue;
        const l = leaf(p);
        nodes[p.name] = { name: p.name, type: p.type, region: regionOf(p.name), udp: p.udp, alive: l.alive !== false, delay: delayOf(l.history?.at(-1)?.delay) };
      }
      const groups: ProxyGroup[] = raws.map(g => ({
        name: g.name, type: g.type as GroupType, now: g.now ?? '', all: [...g.all!], hidden: g.hidden || undefined, testUrl: g.testUrl || undefined,
      }));
      groupsSeen = Object.fromEntries(groups.map(g => [g.name, g]));
      return { groups, nodes };
    },

    async select(group, member) {
      await call('PUT', `/proxies/${enc(group)}`, { name: member });
    },

    async testGroup(group, url, timeoutMs = 5000) {
      if (!groupsSeen) await self.getProxies();
      const g = groupsSeen?.[group];
      const target = url ?? g?.testUrl ?? DELAY_URL;
      const r = await call('GET', `/group/${enc(group)}/delay?url=${enc(target)}&timeout=${timeoutMs}`, undefined, { timeoutMs: timeoutMs + 5000, accept: DELAY_FAILED });
      const got = r.status === 200 ? (r.data as Record<string, unknown>) : {};
      const out: Record<string, Latency> = {};
      for (const name of new Set([...(g?.all ?? []), ...Object.keys(got)])) out[name] = delayOf(got[name]);
      return out;
    },

    async testNode(name, url = DELAY_URL, timeoutMs = 5000) {
      const r = await call('GET', `/proxies/${enc(name)}/delay?url=${enc(url)}&timeout=${timeoutMs}`, undefined, { timeoutMs: timeoutMs + 3000, accept: DELAY_FAILED });
      return r.status === 200 ? delayOf((r.data as { delay?: number }).delay) : null;
    },

    // 不用 /traffic：它是流式接口，普通请求读不到“一次采样”就结束不了
    async traffic() {
      const c = await get<RawConnections>('/connections');
      const at = now();
      const p = prevTotals;
      const dt = p ? (at - p.at) / 1000 : 0;
      let rate: Rate = { up: 0, down: 0 };
      if (p && dt < 0.5) return { ...p.rate };
      if (p && c.uploadTotal >= p.up && c.downloadTotal >= p.down) {
        rate = { up: (c.uploadTotal - p.up) / dt, down: (c.downloadTotal - p.down) / dt };
      }
      prevTotals = { at, up: c.uploadTotal, down: c.downloadTotal, rate };
      return { ...rate };
    },

    async getConnections(): Promise<ConnectionsSnapshot> {
      const c = await get<RawConnections>('/connections');
      const at = now();
      const dt = prevConns ? (at - prevConns.at) / 1000 : 0;
      const byId = new Map<string, { up: number; down: number }>();
      const connections: MihomoConnection[] = (c.connections ?? []).map(x => {
        const m = x.metadata;
        const old = prevConns?.byId.get(x.id);
        byId.set(x.id, { up: x.upload, down: x.download });
        return {
          id: x.id,
          host: m.host || m.sniffHost || '',
          destination: `${m.destinationIP}:${m.destinationPort}`,
          network: m.network === 'udp' ? 'udp' : 'tcp',
          sourceIp: m.sourceIP,
          chains: x.chains ?? [],
          rule: x.rule,
          rulePayload: x.rulePayload,
          upload: x.upload,
          download: x.download,
          rate: old && dt > 0
            ? { up: Math.max(0, x.upload - old.up) / dt, down: Math.max(0, x.download - old.down) / dt }
            : { up: 0, down: 0 },
          start: parseTime(x.start),
        };
      });
      prevConns = { at, byId };
      return { uploadTotal: c.uploadTotal, downloadTotal: c.downloadTotal, connections, memory: c.memory };
    },

    async closeConnection(id) {
      await call('DELETE', `/connections/${enc(id)}`);
    },

    async closeAllConnections() {
      await call('DELETE', '/connections');
    },

    async getProviders() {
      const r = await get<{ providers?: Record<string, RawProvider> }>('/providers/proxies', 15_000);
      return Object.values(r.providers ?? {}).filter(p => p.vehicleType !== 'Compatible').map(p => {
        const out: ProxyProvider = { name: p.name, vehicleType: p.vehicleType, nodeCount: p.proxies?.length ?? 0, updatedAt: parseTime(p.updatedAt) };
        const s = p.subscriptionInfo;
        if (s && (s.Total || s.Upload || s.Download)) {
          out.subscription = { upload: s.Upload ?? 0, download: s.Download ?? 0, total: s.Total ?? 0, expire: (s.Expire ?? 0) * 1000 };
        }
        return out;
      });
    },

    async updateProvider(name) {
      await call('PUT', `/providers/proxies/${enc(name)}`, undefined, { timeoutMs: 30_000 });
      providerMap = null;
    },

    async getRules() {
      const r = await get<{ rules?: { type: string; payload: string; proxy: string; extra?: { disabled?: boolean } }[] }>('/rules');
      return (r.rules ?? []).filter(x => !x.extra?.disabled).map((x): Rule => ({ type: RULE_TYPES[x.type] ?? x.type, payload: x.payload, proxy: x.proxy }));
    },

    async checkExit(group, checkUrl) {
      const body = opts.fetchExit
        ? await opts.fetchExit(checkUrl, group)
        : (await http({ url: checkUrl, allowPublic: true, timeoutMs: 10_000 })).data;
      return { ...parseExit(body), checkedAt: now() };
    },
  };

  return self;
}
