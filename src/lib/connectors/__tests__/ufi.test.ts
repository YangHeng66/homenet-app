import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUfi, ufiAuth, ufiSign, zteAd, ztePassword } from '../ufi';
import { fakeNet, reply } from './fake-net';

const URL_ = 'http://192.168.0.1:2333';
const AUTH = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';
const GET = '/api/goform/goform_get_cmd_process';
const SET = '/api/goform/goform_set_cmd_process';
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/*
 * 对照值：按 tr3000-dash/www/cgi-bin/dash 的 ufi_sign / f50_auth / 登录口令算法，
 * 用 Node 自带的 crypto 模块逐步算出（生成脚本：scripts/ufi-sign-vectors.mjs）。
 */
describe('UFI-TOOLS 签名（对照 tr3000-dash 的算法）', () => {
  it('kano-sign', () => {
    expect(ufiSign('GET', '/api/baseDeviceInfo', '1731000000000')).toBe('f563b816b37bf3371d29c2215e06c1b940b74152f81f10040c0a2c886e0baf41');
    expect(ufiSign('POST', SET, '1762761600123')).toBe('3b71c891c61c936aa38c30da75d2eb8586c5a9634fb63f07a528510e4b9ebe76');
    expect(ufiSign('GET', GET, '1')).toBe('52450a60182b6a335cdd1089a2e6833dd371fee02a37a12c1593d01234f704fb');
  });
  it('authorization = sha256(口令去掉首尾空白)', () => {
    expect(ufiAuth('admin')).toBe(AUTH);
    expect(ufiAuth('  admin\n')).toBe(AUTH);
    expect(ufiAuth('口令test')).toBe('ab27a5a360082bb05edd2a593335570ed53df7805cc8d0f16ecc72d9e46818a7');
  });
  it('中兴 goform 的 AD 和登录口令（十六进制大写）', () => {
    expect(zteAd('WA_INNER_1.0', 'CR_F50_B15', 'rd123')).toBe('FBB48527EA2535B3D561426601A4B81B06C0CB2FF7FB3070017C6F817EAC38AE');
    expect(ztePassword('zte-pass', 'LD99')).toBe('495BB92423D980F18853DCA25855DC02B5667F062052A78B2FC898EE16373DD1');
  });
});

const BASE_INFO = {
  app_ver: '4.1.5', model: 'F50', daily_data: 6_720_000_000, monthly_data: 45_200_000_000, cpu_temp: 55, boot_time: 82_800_000,
  cpu_temp_list: [{ type: 'soc-thmzone', temp: 55000 }, { type: 'board-thmzone', temp: 52000 }, { type: 'nr-thmzone', temp: 51000 }, { type: 'pa-thmzone', temp: 49000 }],
};

/* 5G SA 下 goform 的字段样例（字段名来自真机记录，取值是示例） */
const FIELDS: Record<string, string> = {
  network_type: '20', network_provider: '中国移动', ppp_status: 'ipv4_ipv6_connected', signalbar: '4',
  Nr_bands: '41', Nr_pci: '371', Nr_snr: '4.5', nr_rsrp: '-86', nr_rsrq: '-12', Z5g_rsrp: '-86',
  Lte_bands: '', Lte_pci: '', Lte_snr: '', lte_rsrp: '', lte_rsrq: '',
  net_select: 'WL_AND_5G', realtime_rx_thrpt: '5242880', realtime_tx_thrpt: '318000',
  cr_version: 'CR_F50_B15', wa_inner_version: 'WA_INNER_1.0', RD: 'rd123', LD: 'LD99', Language: 'zh-cn',
  roam_setting_option: '', dial_roam_setting_option: 'off', nr_band_lock: '41', lte_band_lock: '39',
  usb_network_protocal: '1', indicator_light_switch: '1', usb_port_switch: '0', wifi_access_sta_num: '2',
};

const WIFI = {
  WiFiModuleSwitch: '1',
  ResponseList: [
    { ChipIndex: '0', AccessPointIndex: '0', AccessPointSwitchStatus: '0', SSID: 'F50_A1B2', ApBroadcastDisabled: '0' },
    { ChipIndex: '1', AccessPointIndex: '0', AccessPointSwitchStatus: '1', SSID: 'F50_A1B2_5G', ApBroadcastDisabled: '1' },
  ],
};

const SMS = [
  { id: '12', number: '10086', content: b64('您好 hello'), date: '26,11,10,09,30,05,+32', tag: '1' },
  { id: '11', number: '10010', content: b64('我发出去的'), date: '26,11,10,08,00,00,+32', tag: '2' },
  { id: '10', number: '106', content: b64('旧短信'), date: '26,11,09,08,00,00,+32', tag: '0' },
];

function f50(over: Partial<{ fields: Record<string, string>; savedCookie: string; pwd: string; setResult: string; loginResult: string; wifi: object; base: object }> = {}) {
  const s = {
    fields: { ...FIELDS, ...over.fields }, validCookie: 'zc=1', savedCookie: over.savedCookie ?? 'zc=1', pwd: over.pwd ?? '',
    setResult: over.setResult ?? 'success', loginResult: over.loginResult ?? '0', wifi: over.wifi ?? WIFI, base: over.base ?? BASE_INFO,
    posts: [] as Record<string, string>[], logins: [] as Record<string, string>[],
  };
  const net = fakeNet(c => {
    const h = c.headers;
    if (h.authorization !== AUTH || h['kano-sign'] !== ufiSign(c.method, c.path, h['kano-t'])) return reply(401);
    const logged = h['kano-cookie'] === s.validCookie;
    switch (c.path) {
      case '/api/baseDeviceInfo': return s.base;
      case '/api/get_cookie': return { cookie: s.savedCookie };
      case '/api/set_cookie': s.savedCookie = c.json.cookie; return { result: 'success' };
      case '/api/get_official_web_password': return { pwd: s.pwd };
      case '/api/getSupportNrBandList': return { slot: 0, band_list: [41, 1, 28, 78, 79] };
      case '/api/disable_fota': return { result: '执行成功' };
      case GET: {
        const cmds = (c.query.get('cmd') ?? '').split(',');
        if (cmds[0] === 'sms_data_total') return { messages: SMS };
        if (cmds.includes('queryAccessPointInfo')) return logged ? s.wifi : {};
        return Object.fromEntries(cmds.map(k => [k, k === 'loginfo' ? (logged ? 'ok' : '') : k === 'LD' || logged ? s.fields[k] ?? '' : '']));
      }
      case SET: {
        const form = Object.fromEntries(c.form);
        if (form.goformId === 'LOGIN_MULTI_USER') {
          s.logins.push(form);
          if (s.loginResult !== '0') return { result: s.loginResult };
          s.validCookie = 'zc=new';
          return reply(200, { result: '0' }, { 'Kano-Cookie': 'zc=new; path=/; HttpOnly' });
        }
        if (!logged) return { result: 'failure' };
        s.posts.push(form);
        return { result: s.setResult };
      }
    }
    return reply(404);
  });
  return { ...net, s, gets: () => net.calls.filter(c => c.path === GET).map(c => c.query.get('cmd')) };
}

const make = (d: ReturnType<typeof f50>, opts: Parameters<typeof createUfi>[2] = {}) =>
  createUfi({ url: URL_, secret: 'admin' }, d.http, { sleep: async () => {}, ...opts });

afterEach(() => vi.useRealTimers());

describe('UFI 连接器：鉴权', () => {
  it('请求头：authorization / kano-t / kano-sign（路径不含查询串）', async () => {
    const d = f50();
    const u = createUfi({ url: URL_ + '/' }, d.http, { now: () => 1731000000000 });
    await u.login(' admin ');
    expect(d.calls[0].url).toBe(`${URL_}/api/baseDeviceInfo`);
    expect(d.calls[0].headers).toMatchObject({
      authorization: AUTH, 'kano-t': '1731000000000',
      'kano-sign': 'f563b816b37bf3371d29c2215e06c1b940b74152f81f10040c0a2c886e0baf41',
    });
  });

  it('口令不对 → auth；之前的口令不受影响', async () => {
    const d = f50();
    const u = make(d);
    await expect(u.login('wrong')).rejects.toMatchObject({ kind: 'auth' });
    await expect(u.usbMode()).resolves.toBe('rndis');
  });

  it('没填口令时不发请求', async () => {
    const d = f50();
    await expect(createUfi({ url: URL_ }, d.http).status()).rejects.toMatchObject({ kind: 'auth' });
    expect(d.calls).toHaveLength(0);
  });

  it('goform 查询串总以 &_=时间戳 结尾（UFI 代理会在末尾再拼 ?isTest=false）', async () => {
    const d = f50();
    await make(d, { now: () => 1731000000000 }).usbMode();
    for (const c of d.calls.filter(x => x.path === GET)) expect(c.url).toMatch(/&_=1731000000000$/);
  });
});

describe('UFI 连接器：中兴后台会话', () => {
  it('先取 UFI 保存的 cookie，30 秒内不重复检查登录状态', async () => {
    let t = 1_000_000;
    const d = f50();
    const u = make(d, { now: () => t });
    await u.usbMode();
    expect(d.calls.map(c => c.path)).toEqual(['/api/get_cookie', GET, GET]);
    expect(d.gets()).toEqual(['loginfo', 'usb_network_protocal']);
    expect(d.calls[2].headers['kano-cookie']).toBe('zc=1');

    await u.usbMode();
    expect(d.calls).toHaveLength(4);
    t += 31_000;
    await u.usbMode();
    expect(d.gets().slice(-2)).toEqual(['loginfo', 'usb_network_protocal']);
  });

  it('同时发起多个读取时只检查一次会话', async () => {
    const d = f50();
    const u = make(d);
    await Promise.all([u.usbMode(), u.rat(), u.toggles(), u.bands()]);
    expect(d.calls.filter(c => c.path === '/api/get_cookie')).toHaveLength(1);
    expect(d.gets().filter(c => c === 'loginfo')).toHaveLength(1);
  });

  it('同时发起的写操作排队执行，各用各的 RD', async () => {
    const d = f50();
    const u = make(d);
    await Promise.all([u.setToggle('led', false), u.setToggle('adb', true), u.setRoaming(false)]);
    const order = d.calls.filter(c => c.path === SET || c.query.get('cmd') === 'RD').map(c => (c.path === SET ? 'POST' : 'RD'));
    expect(order).toEqual(['RD', 'POST', 'RD', 'POST', 'RD', 'POST']);
  });

  it('手里的 cookie 失效时换 UFI 新保存的那个', async () => {
    let t = 0;
    const d = f50();
    const u = make(d, { now: () => t });
    await u.usbMode();
    d.s.validCookie = d.s.savedCookie = 'zc=2';
    t += 31_000;
    await expect(u.usbMode()).resolves.toBe('rndis');
    expect(d.calls.at(-1)!.headers['kano-cookie']).toBe('zc=2');
    expect(d.s.logins).toHaveLength(0);
  });

  it('cookie 都失效：用 UFI 里保存的后台密码登录一次，并把新 cookie 存回 UFI', async () => {
    const d = f50({ savedCookie: '', pwd: 'zte-pass' });
    const u = make(d);
    await expect(u.usbMode()).resolves.toBe('rndis');
    expect(d.s.logins).toEqual([{ goformId: 'LOGIN_MULTI_USER', isTest: 'false', password: '495BB92423D980F18853DCA25855DC02B5667F062052A78B2FC898EE16373DD1', IP: 'localhost', user: 'admin' }]);
    expect(d.s.savedCookie).toBe('zc=new');
    expect(d.calls.at(-1)!.headers['kano-cookie']).toBe('zc=new');
  });

  it('登录失败后 10 分钟内不再尝试，避免把中兴账号锁住', async () => {
    let t = 0;
    const d = f50({ savedCookie: '', pwd: 'bad', loginResult: '3' });
    const u = make(d, { now: () => t });
    await expect(u.usbMode()).rejects.toMatchObject({ kind: 'auth' });
    t += 60_000;
    await expect(u.usbMode()).rejects.toMatchObject({ kind: 'auth' });
    expect(d.s.logins).toHaveLength(1);
    t += 600_000;
    await expect(u.usbMode()).rejects.toMatchObject({ kind: 'auth' });
    expect(d.s.logins).toHaveLength(2);
  });

  it('UFI 里没存后台密码 → auth，不去登录', async () => {
    const d = f50({ savedCookie: '' });
    await expect(make(d).usbMode()).rejects.toMatchObject({ kind: 'auth' });
    expect(d.s.logins).toHaveLength(0);
  });
});

describe('UFI 连接器：状态', () => {
  it('5G SA', async () => {
    const d = f50();
    expect(await make(d).status()).toEqual({
      model: 'F50', firmware: 'CR_F50_B15', ufiVersion: '4.1.5', uptime: 82800,
      signal: { network: '5G SA', operator: '中国移动', bands: ['n41'], rsrp: -86, rsrq: -12, sinr: 4.5, pci: 371, bars: 4 },
      temps: { board: 52, soc: 55, modem: 51, pa: 49, throttleAt: 60 },
      rate: { down: 5242880, up: 318000 }, dataOn: true, pdp: 'IPv4v6', roaming: false,
      monthBytes: 45_200_000_000, todayBytes: 6_720_000_000,
    });
  });

  it('5G NSA：NR 和 LTE 字段都有', async () => {
    const d = f50({ fields: { Nr_bands: '78', Lte_bands: '3', lte_rsrp: '-95', Lte_pci: '120', dial_roam_setting_option: 'on' } });
    const s = await make(d).status();
    expect(s.signal).toMatchObject({ network: '5G NSA', bands: ['n78', 'B3'], rsrp: -86, pci: 371 });
    expect(s.roaming).toBe(true);
  });

  it('4G：用 LTE 字段；断开时 dataOn 为 false；温度列表是字符串、单位是 ℃ 也能读', async () => {
    const d = f50({
      fields: { network_type: '13', Nr_bands: '', Nr_pci: '', Nr_snr: '', nr_rsrp: '', nr_rsrq: '', Z5g_rsrp: '', Lte_bands: '39', Lte_pci: '88', Lte_snr: '11', lte_rsrp: '-101', lte_rsrq: '-9', ppp_status: 'ppp_disconnected', signalbar: '9' },
      base: { ...BASE_INFO, cpu_temp_list: JSON.stringify([{ type: 'cpu', temp: 47 }]), cpu_temp: 47 },
    });
    const s = await make(d, { throttleAt: 70 }).status();
    expect(s.signal).toEqual({ network: '4G', operator: '中国移动', bands: ['B39'], rsrp: -101, rsrq: -9, sinr: 11, pci: 88, bars: 4 });
    expect(s).toMatchObject({ dataOn: false, pdp: '', temps: { board: 47, soc: 47, modem: 47, pa: 47, throttleAt: 70 } });
  });
});

describe('UFI 连接器：写 goform', () => {
  it('带 AD；版本号只读一次，RD 每次都读', async () => {
    const d = f50();
    const u = make(d);
    await u.setUsbMode('ecm');
    expect(d.s.posts).toEqual([{ goformId: 'SET_USB_NETWORK_PROTOCAL', usb_network_protocal: '2', isTest: 'false', AD: 'FBB48527EA2535B3D561426601A4B81B06C0CB2FF7FB3070017C6F817EAC38AE' }]);
    const post = d.calls.find(c => c.path === SET)!;
    expect(post.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'kano-cookie': 'zc=1' });
    await u.setUsbMode('auto');
    expect(d.gets()).toEqual(['loginfo', 'Language,cr_version,wa_inner_version', 'RD', 'RD']);
    expect(d.s.posts[1].usb_network_protocal).toBe('0');
  });

  it('F50 不接受时抛 device', async () => {
    const d = f50({ setResult: 'failure' });
    await expect(make(d).reboot()).rejects.toMatchObject({ kind: 'device' });
  });

  it('各个开关对应的 goformId 和参数', async () => {
    const d = f50();
    const u = make(d);
    await u.setToggle('led', false);
    await u.setToggle('adb', true);
    await u.setRoaming(true);
    await u.setData(true);
    await u.redial();
    await u.reboot();
    const sent = d.s.posts.map(({ isTest: _i, AD: _a, ...rest }) => rest);
    expect(sent).toEqual([
      { goformId: 'INDICATOR_LIGHT_SETTING', indicator_light_switch: '0' },
      { goformId: 'USB_PORT_SETTING', usb_port_switch: '1' },
      { goformId: 'SET_CONNECTION_MODE', ConnectionMode: 'auto_dial', roam_setting_option: 'on', dial_roam_setting_option: 'on' },
      { goformId: 'CONNECT_NETWORK' },
      { goformId: 'DISCONNECT_NETWORK' },
      { goformId: 'CONNECT_NETWORK' },
      { goformId: 'REBOOT_DEVICE' },
    ]);
  });

  it('读取：USB 模式、制式、开关', async () => {
    const u = make(f50({ fields: { usb_network_protocal: '2', net_select: 'Only_5G', usb_port_switch: '1' } }));
    expect(await u.usbMode()).toBe('ecm');
    expect(await u.rat()).toBe('sa');
    expect(await u.toggles()).toEqual({ led: true, adb: true });
    expect(await make(f50({ fields: { net_select: 'LTE_AND_5G' } })).rat()).toBe('nsa');
    expect(await make(f50({ fields: { net_select: 'WCDMA_AND_LTE' } })).rat()).toBe('lte');
  });

  it('拦截系统更新：只能开（/api/disable_fota），关和读状态没有接口', async () => {
    const d = f50();
    const u = make(d);
    await u.setToggle('fotaBlock', true);
    expect(d.calls.at(-1)!.path).toBe('/api/disable_fota');
    await expect(u.setToggle('fotaBlock', false)).rejects.toMatchObject({ kind: 'unsupported' });
  });
});

describe('UFI 连接器：可回滚的操作', () => {
  it('setRat：写 BearerPreference；revert 写回原值', async () => {
    const d = f50();
    const rb = await make(d).setRat('sa');
    expect(d.s.posts.at(-1)).toMatchObject({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: 'Only_5G' });
    await rb.revert();
    expect(d.s.posts.at(-1)).toMatchObject({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: 'WL_AND_5G' });
    await rb.revert();
    expect(d.s.posts).toHaveLength(2);
  });

  it('setData(false)：返回 Rollback，到点没确认由 App 重新连上', async () => {
    vi.useFakeTimers();
    const d = f50();
    const rb = await make(d).setData(false);
    expect(d.s.posts.at(-1)).toMatchObject({ goformId: 'DISCONNECT_NETWORK' });
    expect(rb).toMatchObject({ timeout: 90 });
    await vi.advanceTimersByTimeAsync(89_000);
    expect(d.s.posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(d.s.posts.at(-1)).toMatchObject({ goformId: 'CONNECT_NETWORK' });
  });

  it('confirm 之后不再自动恢复', async () => {
    vi.useFakeTimers();
    const d = f50();
    const rb = await make(d).setRat('lte');
    await rb.confirm();
    await vi.advanceTimersByTimeAsync(120_000);
    await rb.revert();
    expect(d.s.posts).toHaveLength(1);
  });

  it('bands：当前锁频和支持的频段', async () => {
    const u = make(f50());
    expect(await u.bands()).toEqual({
      current: { nr: ['n41'], lte: ['B39'] },
      supported: { nr: ['n1', 'n28', 'n41', 'n78', 'n79'], lte: ['B1', 'B3', 'B5', 'B8', 'B34', 'B38', 'B39', 'B40', 'B41'] },
    });
    expect((await make(f50({ fields: { nr_band_lock: '', lte_band_lock: '' } })).bands()).current).toEqual({ nr: [], lte: [] });
  });

  it('lockBands：先 LTE 后 NR；revert 写回原来的锁频', async () => {
    const d = f50();
    const rb = await make(d).lockBands({ nr: ['n78'], lte: ['B3', 'B1'] });
    const sent = () => d.s.posts.map(p => [p.goformId, p.lte_band_lock ?? p.nr_band_lock]);
    expect(sent()).toEqual([['LTE_BAND_LOCK', '1,3'], ['NR_BAND_LOCK', '78']]);
    expect(rb.timeout).toBe(60);
    await rb.revert();
    expect(sent().slice(2)).toEqual([['LTE_BAND_LOCK', '39'], ['NR_BAND_LOCK', '41']]);
  });

  it('lockBands：解除 NR 锁频要先写全部频段再写空（写空值不解除 modem 的锁）', async () => {
    const d = f50();
    await make(d).lockBands({ nr: [], lte: [] });
    expect(d.s.posts.map(p => [p.goformId, p.lte_band_lock ?? p.nr_band_lock])).toEqual([
      ['LTE_BAND_LOCK', ''], ['NR_BAND_LOCK', '1,28,41,78,79'], ['NR_BAND_LOCK', ''],
    ]);
  });

  it('lockBands：不支持或写错的频段不会写设备', async () => {
    const d = f50();
    const u = make(d);
    await expect(u.lockBands({ nr: ['n3'], lte: [] })).rejects.toMatchObject({ kind: 'device' });
    await expect(u.lockBands({ nr: ['n41; x'], lte: [] })).rejects.toMatchObject({ kind: 'device' });
    await expect(u.lockBands({ nr: [], lte: ['B999'] })).rejects.toMatchObject({ kind: 'device' });
    expect(d.s.posts).toHaveLength(0);
  });
});

describe('UFI 连接器：Wi-Fi 和短信', () => {
  it('wifi：当前启用的那个芯片', async () => {
    expect(await make(f50()).wifi()).toEqual({ on: true, ssid: 'F50_A1B2_5G', band: '5', hidden: true, clients: 2 });
    const off = { WiFiModuleSwitch: '0', ResponseList: WIFI.ResponseList.map(x => ({ ...x, AccessPointSwitchStatus: '0' })) };
    expect(await make(f50({ wifi: off })).wifi()).toEqual({ on: false, ssid: 'F50_A1B2', band: '2.4', hidden: false, clients: 0 });
  });

  it('setWifi：关 → switchWiFiModule；开或换频段 → switchWiFiChip', async () => {
    const d = f50();
    const u = make(d);
    await u.setWifi({ on: false });
    await u.setWifi({ on: true });
    await u.setWifi({ band: '2.4' });
    expect(d.s.posts.map(({ isTest: _i, AD: _a, ...rest }) => rest)).toEqual([
      { goformId: 'switchWiFiModule', SwitchOption: '0' },
      { goformId: 'switchWiFiChip', ChipEnum: 'chip2', GuestEnable: '0' },
      { goformId: 'switchWiFiChip', ChipEnum: 'chip1', GuestEnable: '0' },
    ]);
  });

  it('setWifi：隐藏 SSID 没有确认过的接口 → unsupported，不写设备', async () => {
    const d = f50();
    const u = make(d);
    await expect(u.setWifi({ hidden: true })).rejects.toMatchObject({ kind: 'unsupported' });
    expect(d.s.posts).toHaveLength(0);
  });

  it('sms：只要收到的短信，正文 base64 解码', async () => {
    const d = f50();
    expect(await make(d).sms()).toEqual([
      { id: '12', from: '10086', text: '您好 hello', time: new Date(2026, 10, 10, 9, 30, 5).getTime(), read: false },
      { id: '10', from: '106', text: '旧短信', time: new Date(2026, 10, 9, 8, 0, 0).getTime(), read: true },
    ]);
    const q = d.calls.at(-1)!.query;
    expect([q.get('cmd'), q.get('page'), q.get('data_per_page'), q.get('mem_store'), q.get('tags'), q.get('order_by')]).toEqual(['sms_data_total', '0', '500', '1', '100', 'order by id desc']);
  });
});

describe('UFI 连接器：待真机抓包的接口', () => {
  it('飞行模式、测速 → unsupported，不发请求', async () => {
    const d = f50();
    const u = make(d);
    await expect(u.setAirplane(true)).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(u.speedTest()).rejects.toMatchObject({ kind: 'unsupported' });
    expect(d.calls).toHaveLength(0);
  });

  it('limits 列出暂不支持的操作和原因，界面据此禁用控件', () => {
    const u = make(f50());
    expect(Object.keys(u.limits ?? {}).sort()).toEqual(['airplane', 'fotaUnblock', 'hidden', 'speedTest']);
    for (const v of Object.values(u.limits ?? {})) expect(v).toMatch(/\S{4,}/);
  });
});
