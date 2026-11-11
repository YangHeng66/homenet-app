import { describe, expect, it } from 'vitest';
import { createOpenWrt } from '../openwrt';
import { fakeNet } from './fake-net';

const URL_ = 'http://192.168.1.1';
const SID = 'a'.repeat(32);
const NO_SID = '0'.repeat(32);
const MiB = 1024 * 1024;

const DENIED = Symbol('denied');
type Route = (args: any, sid: string) => unknown;

/** 假的 uhttpd-mod-ubus：按 "对象 方法" 查表；返回数字表示 ubus 状态码，DENIED 表示会话无效 */
function ubus(routes: Record<string, Route>) {
  const log: [string, any, string][] = [];
  const net = fakeNet(c => {
    const one = (m: any) => {
      const [sid, object, method, args] = m.params;
      log.push([`${object} ${method}`, args, sid]);
      const fn = routes[`${object} ${method}`];
      const out = fn ? fn(args, sid) : 3;
      if (out === DENIED) return { jsonrpc: '2.0', id: m.id, error: { code: -32002, message: 'Access denied' } };
      return { jsonrpc: '2.0', id: m.id, result: typeof out === 'number' ? [out] : [0, out] };
    };
    return Array.isArray(c.json) ? c.json.map(one) : one(c.json);
  });
  return { ...net, log, names: () => log.map(l => l[0]) };
}

const login: Record<string, Route> = {
  'session login': a => (a.username === 'root' && a.password === 'pw' ? { ubus_rpc_session: SID, timeout: 300, expires: 299 } : 6),
};

async function loggedIn(routes: Record<string, Route>, opts?: Parameters<typeof createOpenWrt>[2]) {
  const u = ubus({ ...login, ...routes });
  const r = createOpenWrt({ url: URL_ }, u.http, opts);
  await r.login('root', 'pw');
  u.log.length = 0;
  return { r, ...u };
}

const DUMP = {
  interface: [
    { interface: 'loopback', up: true, l3_device: 'lo', 'ipv4-address': [{ address: '127.0.0.1', mask: 8 }] },
    { interface: 'lan', up: true, uptime: 90000, l3_device: 'br-lan', 'ipv4-address': [{ address: '192.168.1.1', mask: 24 }] },
    { interface: 'wan', up: true, uptime: 3600, l3_device: 'eth0', device: 'eth0', 'ipv4-address': [{ address: '10.75.12.3', mask: 24 }] },
    { interface: 'wan6', up: true, uptime: 3500, l3_device: 'eth0', 'ipv6-address': [{ address: 'fe80::2', mask: 64 }, { address: '2001:db8::2', mask: 64 }] },
  ],
};

const WIRELESS = {
  radio0: { up: true, disabled: false, config: { band: '2g', channel: 'auto', htmode: 'HE20' }, interfaces: [{ ifname: 'phy0-ap0', section: 'default_radio0', config: { mode: 'ap', ssid: 'MyHome' } }] },
  radio1: { up: true, disabled: false, config: { band: '5g', channel: '149', htmode: 'HE80' }, interfaces: [{ ifname: 'phy1-ap0', section: 'default_radio1', config: { mode: 'ap', ssid: 'MyHome' } }] },
  radio2: { up: false, disabled: true, config: { band: '6g', channel: 37, htmode: 'HE160' }, interfaces: [{ section: 'default_radio2', config: { mode: 'ap', ssid: 'MyHome-6G' } }] },
};

const ASSOC: Record<string, unknown> = {
  'phy0-ap0': { results: [] },
  'phy1-ap0': { results: [{ mac: '02:5A:11:3C:9E:12', signal: -39, rx: { rate: 866000 }, tx: { rate: 1200000 } }] },
};

describe('OpenWrt 连接器：会话', () => {
  it('login 用全 0 会话调 session.login，之后的调用带新会话', async () => {
    const u = ubus({ ...login, 'system board': () => ({ kernel: '6.12.40', hostname: 'OpenWrt', model: 'Example AX3000', release: { distribution: 'OpenWrt', version: '25.12.6', target: 'mediatek/filogic', description: 'OpenWrt 25.12.6 r1' } }) });
    const r = createOpenWrt({ url: URL_ + '/' }, u.http);
    await r.login('root', 'pw');
    expect(u.calls[0]).toMatchObject({ url: URL_ + '/ubus', method: 'POST', json: { jsonrpc: '2.0', method: 'call', params: [NO_SID, 'session', 'login', { username: 'root', password: 'pw' }] } });
    expect(await r.board()).toEqual({ model: 'Example AX3000', hostname: 'OpenWrt', release: 'OpenWrt 25.12.6', kernel: '6.12.40', target: 'mediatek/filogic' });
    expect(u.log[1][2]).toBe(SID);
  });

  it('密码不对 → auth', async () => {
    const u = ubus(login);
    await expect(createOpenWrt({ url: URL_ }, u.http).login('root', 'wrong')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('会话过期时用配置里的账号重新登录一次再重试', async () => {
    let valid = SID;
    const u = ubus({
      'session login': () => ({ ubus_rpc_session: valid }),
      'system reboot': (_a, sid) => (sid === valid ? {} : DENIED),
    });
    const r = createOpenWrt({ url: URL_, username: 'root', secret: 'pw' }, u.http);
    await r.reboot();
    expect(u.names()).toEqual(['system reboot', 'session login', 'system reboot']);
    valid = 'b'.repeat(32);
    await r.reboot();
    expect(u.log.at(-1)![2]).toBe(valid);
  });

  it('同时有多个请求撞上会话过期时只登录一次', async () => {
    const u = ubus({
      'session login': () => ({ ubus_rpc_session: SID }),
      'system board': (_a, sid) => (sid === SID ? { hostname: 'OpenWrt' } : DENIED),
      'service list': (_a, sid) => (sid === SID ? {} : DENIED),
    });
    const r = createOpenWrt({ url: URL_, username: 'root', secret: 'pw' }, u.http);
    await Promise.all([r.board(), r.serviceRunning('nikki'), r.board()]);
    expect(u.names().filter(n => n === 'session login')).toHaveLength(1);
  });

  it('没有账号可用时会话无效 → auth', async () => {
    const u = ubus({ 'system reboot': () => DENIED });
    await expect(createOpenWrt({ url: URL_ }, u.http).reboot()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('sessionTtl / logout', async () => {
    const { r, names } = await loggedIn({ 'session list': () => ({ ubus_rpc_session: SID, timeout: 300, expires: 250 }), 'session destroy': () => ({}) });
    expect(await r.sessionTtl()).toBe(250);
    await r.logout();
    expect(await r.sessionTtl()).toBe(0);
    expect(names()).toEqual(['session list', 'session destroy']);
  });

  it('ubus 报错 → device', async () => {
    const { r } = await loggedIn({});
    await expect(r.board()).rejects.toMatchObject({ kind: 'device' });
  });
});

describe('OpenWrt 连接器：状态', () => {
  it('status：一次批量请求；CPU 和 WAN 速率由两次采样相减', async () => {
    let t = 1_000_000;
    let stat = 'cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 100 0 100 700 100 0 0 0 0 0\n';
    let rx = 1_000_000, tx = 500_000;
    const { r, calls } = await loggedIn({
      'system info': () => ({ uptime: 90000, load: [65536, 32768, 16384], memory: { total: 512 * MiB, free: 100 * MiB, available: 256 * MiB } }),
      'network.interface dump': () => DUMP,
      'network.device status': () => ({ eth0: { speed: '1000F', statistics: { rx_bytes: rx, tx_bytes: tx } }, 'br-lan': { statistics: { rx_bytes: 1, tx_bytes: 1 } } }),
      'file read': a => (a.path === '/proc/stat' ? { data: stat } : a.path.includes('thermal') ? { data: '48123\n' } : 4),
    }, { now: () => t });

    const before = calls.length;
    expect(await r.status()).toEqual({
      uptime: 90000, cpu: 20, memory: 50, memTotal: 512 * MiB, temperature: 48.1, load: [1, 0.5, 0.25],
      wan: { up: true, uptime: 3600, device: 'eth0', ipv4: '10.75.12.3', ipv6: '2001:db8::2', speedMbps: 1000, rate: { up: 0, down: 0 } },
      lanIp: '192.168.1.1',
    });
    expect(calls.length - before).toBe(1);

    t += 2000;
    stat = 'cpu  150 0 150 800 100 0 0 0 0 0\n';
    rx = 3_000_000; tx = 700_000;
    const s = await r.status();
    expect(s.cpu).toBe(50);
    expect(s.wan.rate).toEqual({ down: 1_000_000, up: 100_000 });
  });

  it('status：没有温度传感器、WAN 没起来时不报错', async () => {
    const { r } = await loggedIn({
      'system info': () => ({ uptime: 10, load: [0, 0, 0], memory: { total: 100, free: 40 } }),
      'network.interface dump': () => ({ interface: [DUMP.interface[1], { interface: 'wan', up: false, device: 'eth0' }] }),
      'network.device status': () => ({ eth0: { statistics: { rx_bytes: 0, tx_bytes: 0 } } }),
      'file read': a => (a.path === '/proc/stat' ? { data: 'cpu  0 0 0 0 0 0 0 0\n' } : 4),
    });
    const s = await r.status();
    expect(s.temperature).toBeUndefined();
    expect(s.memory).toBe(60);
    expect(s.cpu).toBe(0);
    expect(s.wan).toEqual({ up: false, uptime: 0, device: 'eth0', rate: { up: 0, down: 0 } });
  });

  it('clients：DHCP 租约 + 固定分配 + 无线关联 + 邻居表', async () => {
    const leases = [
      '1762800000 02:5a:11:3c:9e:12 192.168.1.111 Pixel-9 01:02:5a:11:3c:9e:12',
      '1762800000 02:5a:11:7b:04:5a 192.168.1.88 Desktop-PC *',
      '1700000000 02:5a:11:00:00:01 192.168.1.50 * *',
    ].join('\n') + '\n';
    const neigh = [
      '192.168.1.111 dev br-lan lladdr 02:5a:11:3c:9e:12 REACHABLE',
      '192.168.1.88 dev br-lan lladdr 02:5a:11:7b:04:5a STALE',
      '192.168.1.50 dev br-lan  FAILED',
      '192.168.1.200 dev br-lan lladdr 02:5a:11:aa:bb:cc REACHABLE',
      '10.75.12.1 dev eth0 lladdr 02:00:00:00:00:01 REACHABLE',
    ].join('\n') + '\n';
    const { r, calls, log } = await loggedIn({
      'file read': a => (a.path === '/tmp/dhcp.leases' ? { data: leases } : 4),
      'uci get': () => ({ values: { cfg01: { '.type': 'host', '.name': 'cfg01', mac: '02:5A:11:7B:04:5A', ip: '192.168.1.88', name: 'desktop' } } }),
      'network.wireless status': () => WIRELESS,
      'network.interface dump': () => DUMP,
      'file exec': () => ({ code: 0, stdout: neigh }),
      'iwinfo assoclist': a => ASSOC[a.device],
    }, { now: () => 1762790000_000 });

    const before = calls.length;
    expect(await r.clients()).toEqual([
      { mac: '02:5A:11:3C:9E:12', ip: '192.168.1.111', name: 'Pixel-9', kind: 'phone', link: '5g', signal: -39, rate: { up: 0, down: 0 }, staticLease: false, online: true },
      { mac: '02:5A:11:7B:04:5A', ip: '192.168.1.88', name: 'desktop', kind: 'pc', link: 'wired', rate: { up: 0, down: 0 }, staticLease: true, online: true },
      { mac: '02:5A:11:00:00:01', ip: '192.168.1.50', name: '192.168.1.50', kind: 'other', link: 'wired', rate: { up: 0, down: 0 }, staticLease: false, online: false },
      { mac: '02:5A:11:AA:BB:CC', ip: '192.168.1.200', name: '192.168.1.200', kind: 'other', link: 'wired', rate: { up: 0, down: 0 }, staticLease: false, online: true },
    ]);
    expect(calls.length - before).toBe(2);
    expect(log.find(l => l[0] === 'file exec')![1]).toEqual({ command: '/sbin/ip', params: ['-4', 'neigh', 'show'] });
  });

  it('clients：读不到邻居表时，有线设备按租约是否过期判断在线', async () => {
    const { r } = await loggedIn({
      'file read': () => ({ data: '1762800000 02:5a:11:7b:04:5a 192.168.1.88 nas *\n1700000000 02:5a:11:00:00:01 192.168.1.50 * *\n' }),
      'uci get': () => ({ values: {} }),
      'network.wireless status': () => ({}),
      'network.interface dump': () => DUMP,
      'file exec': () => 6,
    }, { now: () => 1762790000_000 });
    expect((await r.clients()).map(c => [c.ip, c.online])).toEqual([['192.168.1.88', true], ['192.168.1.50', false]]);
  });

  it('wifi：射频、信道表（去掉受限信道）、客户端数', async () => {
    const { r } = await loggedIn({
      'network.wireless status': () => WIRELESS,
      'iwinfo assoclist': a => ASSOC[a.device],
      'iwinfo freqlist': a => ({
        radio0: { results: [{ channel: 1, mhz: 2412 }, { channel: 6, mhz: 2437 }, { channel: 11, mhz: 2462 }] },
        radio1: { results: [{ channel: 36, mhz: 5180, restricted: false }, { channel: 52, mhz: 5260, restricted: true }, { channel: 149, mhz: 5745 }] },
      } as Record<string, unknown>)[a.device] ?? 4,
    });
    expect(await r.wifi()).toEqual([
      { id: 'radio0', band: '2g', up: true, ssid: 'MyHome', channel: 'auto', channels: ['auto', '1', '6', '11'], htmode: 'HE20', clients: 0 },
      { id: 'radio1', band: '5g', up: true, ssid: 'MyHome', channel: '149', channels: ['auto', '36', '149'], htmode: 'HE80', clients: 1 },
      { id: 'radio2', band: '6g', up: false, ssid: 'MyHome-6G', channel: '37', channels: ['auto'], htmode: 'HE160', clients: 0 },
    ]);
  });
});

describe('OpenWrt 连接器：Wi-Fi 改动走 uci apply + rollback', () => {
  const uci = (extra: Record<string, Route> = {}): Record<string, Route> => ({
    'uci get': a => (a.section === 'radio0' ? { values: { '.type': 'wifi-device', '.name': 'radio0', band: '2g' } } : 4),
    'uci set': () => ({}),
    'uci apply': () => ({}),
    'uci confirm': () => ({}),
    'uci rollback': () => ({}),
    'uci revert': () => ({}),
    ...extra,
  });

  it('setWifiEnabled：set → apply(rollback) → 返回的 Rollback 负责 confirm', async () => {
    const { r, log, names } = await loggedIn(uci());
    const rb = await r.setWifiEnabled('radio0', false);
    expect(rb.timeout).toBe(90);
    expect(log.map(l => [l[0], l[1]])).toEqual([
      ['uci get', { config: 'wireless', section: 'radio0' }],
      ['uci set', { config: 'wireless', section: 'radio0', values: { disabled: '1' } }],
      ['uci apply', { rollback: true, timeout: 90 }],
    ]);
    await rb.confirm();
    expect(names().at(-1)).toBe('uci confirm');
    expect(log.at(-1)![2]).toBe(SID);
  });

  it('setWifiChannel + revert：立即让路由器回滚', async () => {
    const { r, log, names } = await loggedIn(uci(), { rollbackTimeout: 30 });
    const rb = await r.setWifiChannel('radio0', '11');
    expect(log[1][1]).toEqual({ config: 'wireless', section: 'radio0', values: { channel: '11' } });
    expect(log[2][1]).toEqual({ rollback: true, timeout: 30 });
    await rb.revert();
    expect(names().at(-1)).toBe('uci rollback');
  });

  it('两次返回的 Rollback id 不同', async () => {
    const { r } = await loggedIn(uci());
    const a = await r.setWifiEnabled('radio0', true);
    const b = await r.setWifiChannel('radio0', 'auto');
    expect(a.id).not.toBe(b.id);
  });

  it('apply 失败时撤掉还没提交的改动', async () => {
    const { r, names } = await loggedIn(uci({ 'uci apply': () => 6 }));
    await expect(r.setWifiEnabled('radio0', true)).rejects.toMatchObject({ kind: 'auth' });
    expect(names()).toEqual(['uci get', 'uci set', 'uci apply', 'uci revert']);
  });

  it('confirm 不重新登录：换了会话路由器不认，重登只会掩盖回滚已经发生', async () => {
    const u = ubus({ 'session login': () => ({ ubus_rpc_session: SID }), ...uci({ 'uci confirm': () => DENIED }) });
    const r = createOpenWrt({ url: URL_, username: 'root', secret: 'pw' }, u.http);
    const rb = await r.setWifiEnabled('radio0', false);
    u.log.length = 0;
    await expect(rb.confirm()).rejects.toMatchObject({ kind: 'auth' });
    expect(u.names()).toEqual(['uci confirm']);
  });

  it('不存在的射频、不合法的信道不会写配置', async () => {
    const { r, names } = await loggedIn(uci());
    await expect(r.setWifiEnabled('radio9', true)).rejects.toMatchObject({ kind: 'device' });
    await expect(r.setWifiEnabled('radio0; reboot', true)).rejects.toMatchObject({ kind: 'device' });
    await expect(r.setWifiChannel('radio0', '36; reboot')).rejects.toMatchObject({ kind: 'device' });
    expect(names().filter(n => n !== 'uci get')).toEqual([]);
  });
});

describe('OpenWrt 连接器：检测 mihomo', () => {
  it('nikki：读 mixin 的 api_listen / api_secret', async () => {
    const { r } = await loggedIn({
      'uci get': a => (a.config === 'nikki' ? { values: { config: { '.type': 'config', enabled: '1' }, mixin: { '.type': 'mixin', api_listen: '[::]:9091', api_secret: 'abc' } } } : 4),
    });
    expect(await r.detectMihomo()).toEqual({ url: 'http://192.168.1.1:9091', secret: 'abc', kind: 'nikki' });
  });

  it('OpenClash：读 cn_port / dashboard_password', async () => {
    const { r } = await loggedIn({
      'uci get': a => (a.config === 'openclash' ? { values: { config: { '.type': 'openclash', enable: '1', cn_port: '9090', dashboard_password: 'pw2' } } } : 4),
    });
    expect(await r.detectMihomo()).toEqual({ url: 'http://192.168.1.1:9090', secret: 'pw2', kind: 'openclash' });
  });

  it('两个都装了时选启用的那个；没设密钥时不带 secret', async () => {
    const { r } = await loggedIn({
      'uci get': a => (a.config === 'nikki'
        ? { values: { config: { '.type': 'config', enabled: '0' }, mixin: { '.type': 'mixin' } } }
        : { values: { config: { '.type': 'openclash', enable: '1' } } }),
    });
    expect(await r.detectMihomo()).toEqual({ url: 'http://192.168.1.1:9090', kind: 'openclash' });
  });

  it('都没装 → null', async () => {
    const { r } = await loggedIn({ 'uci get': () => 4 });
    expect(await r.detectMihomo()).toBeNull();
  });
});

describe('OpenWrt 连接器：服务和系统操作', () => {
  it('serviceAction / serviceRunning', async () => {
    const { r, log } = await loggedIn({
      'rc init': () => ({}),
      'service list': a => (a.name === 'nikki' ? { nikki: { instances: { nikki: { running: true, pid: 123 } } } } : {}),
    });
    await r.serviceAction('nikki', 'restart');
    expect(log[0]).toEqual(['rc init', { name: 'nikki', action: 'restart' }, SID]);
    expect(await r.serviceRunning('nikki')).toBe(true);
    expect(await r.serviceRunning('openclash')).toBe(false);
    await expect(r.serviceAction('../x', 'stop')).rejects.toMatchObject({ kind: 'device' });
  });

  it('resetWan：先 down 再 up', async () => {
    const { r, names } = await loggedIn({ 'network.interface.wan down': () => ({}), 'network.interface.wan up': () => ({}) });
    await r.resetWan();
    expect(names()).toEqual(['network.interface.wan down', 'network.interface.wan up']);
  });

  it('restartNetwork / reboot：请求发出去之后连接断开不算失败', async () => {
    const { r } = await loggedIn({ 'network restart': () => { throw new Error('socket hang up'); }, 'system reboot': () => { throw new Error('socket hang up'); } });
    await expect(r.restartNetwork()).resolves.toBeUndefined();
    await expect(r.reboot()).resolves.toBeUndefined();
  });

  it('backup：sysupgrade -b 到 /tmp，返回文件名', async () => {
    const { r, log } = await loggedIn({
      'system board': () => ({ hostname: 'OpenWrt', release: {} }),
      'file exec': () => ({ code: 0 }),
    }, { now: () => new Date(2026, 10, 10, 12).getTime() });
    expect(await r.backup()).toBe('backup-OpenWrt-2026-11-10.tar.gz');
    expect(log.at(-1)![1]).toEqual({ command: '/sbin/sysupgrade', params: ['-b', '/tmp/backup-OpenWrt-2026-11-10.tar.gz'] });
  });

  it('backup：sysupgrade 返回非 0 → device', async () => {
    const { r } = await loggedIn({ 'system board': () => ({ hostname: 'OpenWrt' }), 'file exec': () => ({ code: 1, stderr: 'no space' }) });
    await expect(r.backup()).rejects.toMatchObject({ kind: 'device' });
  });
});

describe('OpenWrt 连接器：固定分配和改名', () => {
  const host = { cfg01: { '.type': 'host', '.name': 'cfg01', mac: ['02:5A:11:7B:04:5A'], ip: '192.168.1.88', name: 'desktop' } };
  const base = (values: object): Record<string, Route> => ({
    'uci get': () => ({ values }), 'uci add': () => ({ section: 'cfg02' }), 'uci set': () => ({}), 'uci delete': () => ({}), 'uci apply': () => ({}),
  });

  it('新增固定分配', async () => {
    const { r, log } = await loggedIn(base({}));
    await r.setStaticLease('02:5a:11:3c:9e:12', '192.168.1.111', 'pixel');
    expect(log.map(l => [l[0], l[1]])).toEqual([
      ['uci get', { config: 'dhcp', type: 'host' }],
      ['uci add', { config: 'dhcp', type: 'host', values: { mac: '02:5A:11:3C:9E:12', ip: '192.168.1.111', name: 'pixel' } }],
      ['uci apply', { rollback: false }],
    ]);
  });

  it('已有条目时改 IP；取消固定分配时保留名字', async () => {
    const { r, log } = await loggedIn(base(host));
    await r.setStaticLease('02:5A:11:7B:04:5A', '192.168.1.90');
    expect(log[1]).toEqual(['uci set', { config: 'dhcp', section: 'cfg01', values: { ip: '192.168.1.90' } }, SID]);
    log.length = 0;
    await r.setStaticLease('02:5A:11:7B:04:5A', null);
    expect(log[1]).toEqual(['uci delete', { config: 'dhcp', section: 'cfg01', option: 'ip' }, SID]);
  });

  it('renameClient：写 DHCP 主机名；不是合法主机名的名字不写', async () => {
    const { r, log, names } = await loggedIn(base(host));
    await r.renameClient('02:5A:11:7B:04:5A', 'nas-01');
    expect(log[1]).toEqual(['uci set', { config: 'dhcp', section: 'cfg01', values: { name: 'nas-01' } }, SID]);
    log.length = 0;
    await expect(r.renameClient('02:5A:11:7B:04:5A', '客厅电视')).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(r.setStaticLease('not-a-mac', '192.168.1.5')).rejects.toMatchObject({ kind: 'device' });
    await expect(r.setStaticLease('02:5A:11:7B:04:5A', '999.1.1.1')).rejects.toMatchObject({ kind: 'device' });
    expect(names()).toEqual([]);
  });
});
