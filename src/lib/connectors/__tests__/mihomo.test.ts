import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../../errors';
import { createMihomo, parseExit } from '../mihomo';
import { fakeNet, reply, type FakeCall } from './fake-net';

const BASE = 'http://192.168.1.1:9090';

/* 按 mihomo /proxies 的真实结构缩写的样例（节点名是示例） */
const PROXIES = {
  proxies: {
    GLOBAL: { name: 'GLOBAL', type: 'Selector', now: 'DIRECT', all: ['节点选择', '🇺🇸 家宽', '自动', 'DIRECT'], history: [] },
    DIRECT: { name: 'DIRECT', type: 'Direct', udp: true, alive: true, history: [] },
    '自动': { name: '自动', type: 'URLTest', now: 'JP-01', all: ['JP-01', 'US-01'], testUrl: 'https://cp.example.com/generate_204', hidden: true, history: [] },
    '🇺🇸 家宽': { name: '🇺🇸 家宽', type: 'Fallback', now: 'Home-01', all: ['Home-01', 'Home-02'], history: [] },
    '节点选择': { name: '节点选择', type: 'Selector', now: '🇺🇸 家宽', all: ['🇺🇸 家宽', '自动', 'DIRECT'], history: [] },
    'JP-01': { name: 'JP-01', type: 'Shadowsocks', udp: true, alive: true, history: [{ time: '2026-11-10T01:00:00Z', delay: 120 }, { time: '2026-11-10T02:00:00Z', delay: 88 }] },
    'US-01': { name: 'US-01', type: 'Vless', udp: false, alive: false, history: [{ time: '2026-11-10T02:00:00Z', delay: 0 }] },
    'Home-01': { name: 'Home-01', type: 'Hysteria2', udp: true, alive: true, history: [{ time: '2026-11-10T02:00:00Z', delay: 168 }] },
  },
};

const PROVIDERS = {
  providers: {
    default: { name: 'default', type: 'Proxy', vehicleType: 'Compatible', proxies: [{ name: 'DIRECT', type: 'Direct' }] },
    'home-sub': {
      name: 'home-sub', type: 'Proxy', vehicleType: 'HTTP', updatedAt: '2026-11-10T04:00:00.123456789+08:00',
      subscriptionInfo: { Upload: 100, Download: 200, Total: 1000, Expire: 1800000000 },
      proxies: [{ name: 'Home-02', type: 'Vless', udp: true, alive: true, history: [{ time: 'x', delay: 205 }] }],
    },
    inline: { name: 'inline', type: 'Proxy', vehicleType: 'Inline', updatedAt: '0001-01-01T00:00:00Z', proxies: [] },
  },
};

const conn = (id: string, up: number, down: number) => ({
  id, upload: up, download: down, start: '2026-11-10T03:00:00.5Z', chains: ['Home-01', '🇺🇸 家宽', '节点选择'], rule: 'DomainSuffix', rulePayload: 'example.com',
  metadata: { network: 'tcp', type: 'Tun', sourceIP: '192.168.1.111', destinationIP: '203.0.113.9', sourcePort: '51000', destinationPort: '443', host: id === 'b' ? '' : 'www.example.com', sniffHost: '' },
});

describe('mihomo 连接器', () => {
  it('每个请求都带 Bearer secret；没有 secret 时不带', async () => {
    const a = fakeNet(() => ({ version: 'v1.19.15', meta: true }));
    expect(await createMihomo({ url: BASE + '/', secret: 's3cret' }, a.http).version()).toEqual({ version: 'v1.19.15', meta: true });
    expect(a.calls[0]).toMatchObject({ url: BASE + '/version', method: 'GET', headers: { Authorization: 'Bearer s3cret' } });

    const b = fakeNet(() => ({ version: '1.18.0' }));
    expect(await createMihomo({ url: BASE }, b.http).version()).toEqual({ version: '1.18.0', meta: false });
    expect(b.calls[0].headers.Authorization).toBeUndefined();
  });

  it('secret 不对时抛 auth', async () => {
    const { http } = fakeNet(() => reply(401, { message: 'Unauthorized' }));
    const e = await createMihomo({ url: BASE, secret: 'x' }, http).version().catch(x => x);
    expect(e).toBeInstanceOf(ConnectorError);
    expect(e.kind).toBe('auth');
  });

  it('getMode / setMode', async () => {
    const { http, calls } = fakeNet(c => (c.method === 'GET' ? { mode: 'Global', 'mixed-port': 7890 } : reply(204)));
    const m = createMihomo({ url: BASE }, http);
    expect(await m.getMode()).toBe('global');
    await m.setMode('direct');
    expect(calls[1]).toMatchObject({ method: 'PATCH', path: '/configs', json: { mode: 'direct' } });
  });

  it('getProxies：分组按 GLOBAL 的顺序，延迟取最后一次，provider 里的节点补进来', async () => {
    const { http, calls } = fakeNet(c => (c.path === '/proxies' ? PROXIES : c.path === '/providers/proxies' ? PROVIDERS : PROVIDERS.providers['home-sub']));
    const m = createMihomo({ url: BASE }, http);
    const snap = await m.getProxies();

    expect(snap.groups.map(g => g.name)).toEqual(['节点选择', '🇺🇸 家宽', '自动']);
    expect(snap.groups[2]).toEqual({ name: '自动', type: 'URLTest', now: 'JP-01', all: ['JP-01', 'US-01'], hidden: true, testUrl: 'https://cp.example.com/generate_204' });
    expect(snap.nodes['JP-01']).toMatchObject({ type: 'Shadowsocks', udp: true, alive: true, delay: 88 });
    expect(snap.nodes['US-01']).toMatchObject({ alive: false, delay: null });
    expect(snap.nodes['Home-02']).toMatchObject({ type: 'Vless', delay: 205 });
    expect(snap.nodes['节点选择']).toMatchObject({ type: 'Selector', delay: 168, alive: true });
    expect(snap.nodes['🇺🇸 家宽'].region).toBe('US');
    expect(snap.nodes.GLOBAL).toBeUndefined();

    await m.getProxies();
    expect(calls.map(c => c.path)).toEqual(['/proxies', '/providers/proxies', '/proxies', '/providers/proxies/home-sub']);
  });

  it('select：分组名做 URL 编码', async () => {
    const { http, calls } = fakeNet(() => reply(204));
    await createMihomo({ url: BASE }, http).select('🇺🇸 家宽/备用', 'Home-02');
    expect(calls[0]).toMatchObject({ method: 'PUT', json: { name: 'Home-02' } });
    expect(calls[0].url).toBe(`${BASE}/proxies/${encodeURIComponent('🇺🇸 家宽/备用')}`);
  });

  it('testGroup：没回来的成员算超时，默认用分组自己的测速地址', async () => {
    const { http, calls } = fakeNet(c => (c.path === '/proxies' ? PROXIES : { 'JP-01': 91, 'US-01': 0 }));
    const m = createMihomo({ url: BASE }, http);
    expect(await m.testGroup('自动')).toEqual({ 'JP-01': 91, 'US-01': null });
    const c = calls.at(-1)!;
    expect(c.path).toBe('/group/自动/delay');
    expect(c.query.get('url')).toBe('https://cp.example.com/generate_204');
    expect(c.query.get('timeout')).toBe('5000');
    expect(c.timeoutMs).toBeGreaterThan(5000);
  });

  it('testGroup：整组测不通（504）时全部为 null', async () => {
    const { http } = fakeNet(c => (c.path === '/proxies' ? PROXIES : c.path === '/providers/proxies' ? PROVIDERS : reply(504, { message: 'Timeout' })));
    expect(await createMihomo({ url: BASE }, http).testGroup('自动', 'https://t.example.com', 2000)).toEqual({ 'JP-01': null, 'US-01': null });
  });

  it('testNode：成功返回延迟，超时/出错返回 null，其他错误照抛', async () => {
    let res: unknown = { delay: 233 };
    const { http, calls } = fakeNet(() => res);
    const m = createMihomo({ url: BASE }, http);
    expect(await m.testNode('JP-01', 'https://t.example.com/a?b=1', 3000)).toBe(233);
    expect(calls[0].query.get('url')).toBe('https://t.example.com/a?b=1');
    expect(calls[0].query.get('timeout')).toBe('3000');
    res = reply(504, { message: 'Timeout' });
    expect(await m.testNode('JP-01')).toBeNull();
    res = reply(503, { message: 'An error occurred in the delay test' });
    expect(await m.testNode('JP-01')).toBeNull();
    res = reply(404, { message: 'resource not found' });
    await expect(m.testNode('nope')).rejects.toMatchObject({ kind: 'http', status: 404 });
  });

  it('getConnections：速率由连续两次快照相减得出', async () => {
    let t = 1_000_000;
    let body: unknown = { uploadTotal: 1000, downloadTotal: 5000, memory: 9000, connections: [conn('a', 100, 1000), conn('b', 0, 0)] };
    const { http } = fakeNet(() => body);
    const m = createMihomo({ url: BASE }, http, { now: () => t });

    const first = await m.getConnections();
    expect(first).toMatchObject({ uploadTotal: 1000, downloadTotal: 5000, memory: 9000 });
    expect(first.connections[0]).toEqual({
      id: 'a', host: 'www.example.com', destination: '203.0.113.9:443', network: 'tcp', sourceIp: '192.168.1.111',
      chains: ['Home-01', '🇺🇸 家宽', '节点选择'], rule: 'DomainSuffix', rulePayload: 'example.com',
      upload: 100, download: 1000, rate: { up: 0, down: 0 }, start: Date.parse('2026-11-10T03:00:00.5Z'),
    });

    t += 2000;
    body = { uploadTotal: 1400, downloadTotal: 9000, connections: [conn('a', 300, 5000), conn('c', 50, 60)] };
    const second = await m.getConnections();
    expect(second.connections.find(c => c.id === 'a')!.rate).toEqual({ up: 100, down: 2000 });
    expect(second.connections.find(c => c.id === 'c')!.rate).toEqual({ up: 0, down: 0 });
    expect(second.memory).toBeUndefined();

    t += 1000;
    body = { uploadTotal: 0, downloadTotal: 0, connections: null };
    expect((await m.getConnections()).connections).toEqual([]);
  });

  it('traffic：由 /connections 的累计值相减；内核重启后累计值变小时不出负数', async () => {
    let t = 0;
    let body = { uploadTotal: 1000, downloadTotal: 10_000, connections: [] };
    const { http, calls } = fakeNet(() => body);
    const m = createMihomo({ url: BASE }, http, { now: () => t });
    expect(await m.traffic()).toEqual({ up: 0, down: 0 });
    t = 2000; body = { uploadTotal: 3000, downloadTotal: 50_000, connections: [] };
    expect(await m.traffic()).toEqual({ up: 1000, down: 20_000 });
    t = 4000; body = { uploadTotal: 10, downloadTotal: 20, connections: [] };
    expect(await m.traffic()).toEqual({ up: 0, down: 0 });
    expect(calls.every(c => c.path === '/connections')).toBe(true);
  });

  it('关闭连接', async () => {
    const { http, calls } = fakeNet(() => reply(204));
    const m = createMihomo({ url: BASE }, http);
    await m.closeConnection('abc-123');
    await m.closeAllConnections();
    expect(calls.map(c => [c.method, c.path])).toEqual([['DELETE', '/connections/abc-123'], ['DELETE', '/connections']]);
  });

  it('getProviders：去掉 Compatible，订阅信息换算单位', async () => {
    const { http } = fakeNet(() => PROVIDERS);
    expect(await createMihomo({ url: BASE }, http).getProviders()).toEqual([
      { name: 'home-sub', vehicleType: 'HTTP', nodeCount: 1, updatedAt: Date.parse('2026-11-10T04:00:00.123+08:00'), subscription: { upload: 100, download: 200, total: 1000, expire: 1800000000000 } },
      { name: 'inline', vehicleType: 'Inline', nodeCount: 0, updatedAt: 0 },
    ]);
  });

  it('updateProvider', async () => {
    const { http, calls } = fakeNet(() => reply(204));
    await createMihomo({ url: BASE }, http).updateProvider('home sub');
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/providers/proxies/home sub' });
  });

  it('getRules：类型名换成配置文件里的写法，跳过已禁用的', async () => {
    const { http } = fakeNet(() => ({
      rules: [
        { index: 0, type: 'DomainSuffix', payload: 'claude.ai', proxy: 'AI', size: -1 },
        { index: 1, type: 'GeoSite', payload: 'youtube', proxy: 'YouTube', size: 200 },
        { index: 2, type: 'RuleSet', payload: 'streaming', proxy: '节点选择' },
        { index: 3, type: 'IPCIDR', payload: '10.0.0.0/8', proxy: 'DIRECT' },
        { index: 4, type: 'DomainKeyword', payload: 'ads', proxy: 'REJECT', extra: { disabled: true } },
        { index: 5, type: 'FutureType', payload: 'x', proxy: 'DIRECT' },
        { index: 6, type: 'Match', payload: '', proxy: '节点选择' },
      ],
    }));
    expect(await createMihomo({ url: BASE }, http).getRules()).toEqual([
      { type: 'DOMAIN-SUFFIX', payload: 'claude.ai', proxy: 'AI' },
      { type: 'GEOSITE', payload: 'youtube', proxy: 'YouTube' },
      { type: 'RULE-SET', payload: 'streaming', proxy: '节点选择' },
      { type: 'IP-CIDR', payload: '10.0.0.0/8', proxy: 'DIRECT' },
      { type: 'FutureType', payload: 'x', proxy: 'DIRECT' },
      { type: 'MATCH', payload: '', proxy: '节点选择' },
    ]);
  });

  it('checkExit：默认由手机直接请求核对地址（公网地址单次放行），解析出口', async () => {
    const seen: FakeCall[] = [];
    const { http } = fakeNet(c => { seen.push(c); return 'fl=1\nip=203.0.113.24\nloc=US\ncolo=DFW\n'; });
    const info = await createMihomo({ url: BASE, secret: 's3cret' }, http, { now: () => 42 }).checkExit('AI', 'https://ip.example.com/cdn-cgi/trace');
    expect(info).toEqual({ ip: '203.0.113.24', region: 'US', checkedAt: 42 });
    expect(seen[0].url).toBe('https://ip.example.com/cdn-cgi/trace');
    expect(seen[0].headers.Authorization).toBeUndefined();
  });

  it('checkExit：配置了 fetchExit 时走它', async () => {
    const { http, calls } = fakeNet(() => '');
    const m = createMihomo({ url: BASE }, http, { now: () => 7, fetchExit: async (url, group) => JSON.stringify({ ip: '198.51.100.7', via: `${group}|${url}` }) });
    expect(await m.checkExit('AI', 'https://ip.example.com/json')).toEqual({ ip: '198.51.100.7', checkedAt: 7 });
    expect(calls).toHaveLength(0);
  });
});

describe('parseExit', () => {
  it('JSON：常见字段名', () => {
    expect(parseExit({ ip: '203.0.113.24', country_code: 'US', region_code: 'TX', city: 'Dallas', org: 'Example Cable' }))
      .toEqual({ ip: '203.0.113.24', region: 'US·TX', city: 'Dallas', isp: 'Example Cable' });
    expect(parseExit({ query: '198.51.100.73', countryCode: 'US', region: 'CA', city: 'Irvine', isp: 'Example Fiber' }))
      .toEqual({ ip: '198.51.100.73', region: 'US·CA', city: 'Irvine', isp: 'Example Fiber' });
    expect(parseExit('{"origin":"192.0.2.18"}')).toEqual({ ip: '192.0.2.18' });
  });
  it('纯文本 IP（含 IPv6）', () => {
    expect(parseExit(' 203.0.113.5\n')).toEqual({ ip: '203.0.113.5' });
    expect(parseExit('2001:db8::1')).toEqual({ ip: '2001:db8::1' });
  });
  it('认不出来时抛 device', () => {
    expect(() => parseExit('<html>captive portal</html>')).toThrowError(ConnectorError);
    expect(() => parseExit({ error: 'rate limited' })).toThrowError(ConnectorError);
  });
});
