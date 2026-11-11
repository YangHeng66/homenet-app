/*
 * UFI-TOOLS 连接器（中兴 F50 等随身 WiFi，端口 2333）。
 *
 * 依据：
 * - 签名和鉴权：tr3000-dash/www/cgi-bin/dash（真机验证过），和 UFI-TOOLS 仓库的 API_Doc.md 第 1 节一致；
 * - goform 的读写参数：UFI-TOOLS 公开仓库的前端源码（app/frontEnd/public/script/main.js、requests.js）和 API_Doc.md 3.13 节；
 * - 锁频的写入顺序：f50-band-optimizer 在真机上踩出来的。
 * 公开源码里找不到的操作一律抛 unsupported，标着“待真机抓包”，不猜参数。
 */
import { ConnectorError } from '../errors';
import type {
  BandLock, Endpoint, Rat, Rollback, Sms, UfiConnector, UfiDeviceToggles, UfiSignal, UfiStatus, UfiTemps, UfiWifi, UsbMode,
} from '../types';
import { concat, hex, hmacMd5, sha256, utf8 } from './hash';
import type { Http, HttpMethod, HttpResponse } from './http';

export interface UfiOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * 设备开始降速的主板温度。UFI-TOOLS 没有接口能读到，默认 60 是 F50 的 thermal.conf 里 NETLIMIT 第 1 档的门限。
   */
  throttleAt?: number;
  /**
   * 设备支持的 LTE 频段。UFI-TOOLS 只能查 NR 的支持频段（/api/getSupportNrBandList），LTE 没有接口，
   * 默认是 F50 插卡版的频段表；其他机型由配置传入。
   */
  lteBands?: number[];
}

/** UFI-TOOLS 前端里写死的签名常量（公开源码 requests.js），不是用户凭据 */
const SIGN_KEY = 'minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd';
const GOFORM_GET = '/api/goform/goform_get_cmd_process';
const GOFORM_SET = '/api/goform/goform_set_cmd_process';
const SESSION_FRESH_MS = 30_000;
const LOGIN_COOLDOWN_MS = 600_000;
const F50_LTE_BANDS = [1, 3, 5, 8, 34, 38, 39, 40, 41];

const SIGNAL_FIELDS = [
  'network_type', 'network_provider', 'ppp_status', 'signalbar', 'Nr_bands', 'Nr_pci', 'Nr_snr', 'nr_rsrp', 'nr_rsrq',
  'Lte_bands', 'Lte_pci', 'Lte_snr', 'lte_rsrp', 'lte_rsrq', 'Z5g_rsrp', 'realtime_rx_thrpt', 'realtime_tx_thrpt',
  'cr_version', 'roam_setting_option', 'dial_roam_setting_option',
];

const RAT_TO_BEARER: Record<Rat, string> = { auto: 'WL_AND_5G', nsa: 'LTE_AND_5G', sa: 'Only_5G', lte: 'Only_LTE' };
const USB_MODES: UsbMode[] = ['auto', 'rndis', 'ecm'];

const sha256Upper = (s: string) => hex(sha256(utf8(s))).toUpperCase();

/** kano-sign：h = HMAC-MD5(key, "minikano"+METHOD+PATH+t)，SHA256( SHA256(h 前 8 字节) ‖ SHA256(h 后 8 字节) )，全部按字节算 */
export function ufiSign(method: string, path: string, t: string): string {
  const h = hmacMd5(utf8(SIGN_KEY), utf8(`minikano${method}${path}${t}`));
  return hex(sha256(concat(sha256(h.subarray(0, 8)), sha256(h.subarray(8)))));
}

export const ufiAuth = (password: string): string => hex(sha256(utf8(password.trim())));

/** 中兴 goform 写操作的防篡改参数；前端的 SHA256 输出大写十六进制，中间结果也是大写 */
export const zteAd = (waInnerVersion: string, crVersion: string, rd: string): string => sha256Upper(sha256Upper(waInnerVersion + crVersion) + rd);

export const ztePassword = (password: string, ld: string): string => sha256Upper(sha256Upper(password) + ld);

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const has = (v: unknown): boolean => v !== undefined && v !== null && String(v) !== '';
const bandNumbers = (s: unknown): number[] => String(s ?? '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).map(Number);
const unsupported = (what: string) => new ConnectorError('unsupported', `${what}：UFI-TOOLS 公开源码里没有对应接口，待真机抓包确认`);

function parseBands(list: string[], prefix: 'n' | 'B', supported: number[]): number[] {
  const out = [...new Set(list.map(b => {
    const m = new RegExp(`^${prefix}?(\\d{1,3})$`, 'i').exec(String(b).trim());
    if (!m) throw new ConnectorError('device', `频段写法不对：${b}`);
    return Number(m[1]);
  }))].sort((a, b) => a - b);
  const unknown = out.find(b => !supported.includes(b));
  if (unknown !== undefined) throw new ConnectorError('device', `设备不支持 ${prefix}${unknown}`);
  return out;
}

function parseTemps(info: Record<string, unknown>, throttleAt: number): UfiTemps {
  let zones: { type?: string; temp?: number }[] = [];
  try {
    const raw = info.cpu_temp_list;
    zones = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? [];
  } catch { /* 采集失败时这个字段不是合法 JSON，退回 cpu_temp */ }
  // thermal_zone 的原始读数有的机型是毫摄氏度
  const celsius = (t: unknown) => { const n = num(t); return Math.round((n > 1000 ? n / 1000 : n) * 10) / 10; };
  const fallback = celsius(info.cpu_temp);
  const pick = (re: RegExp) => { const z = zones.find(x => re.test(String(x.type ?? ''))); return z ? celsius(z.temp) : fallback; };
  return { board: pick(/board/i), soc: pick(/soc|cpu/i), modem: pick(/(^|[^a-z])nr|modem/i), pa: pick(/(^|[^a-z])pa([^a-z]|$)/i), throttleAt };
}

function parseSignal(s: Record<string, string>): UfiSignal {
  const nr = has(s.Nr_bands) || has(s.nr_rsrp);
  const lte = has(s.Lte_bands) || has(s.lte_rsrp);
  const type = String(s.network_type ?? '');
  // network_type：20 = 5G NR，13 = LTE；SA 下 LTE 字段为空
  const network = type === '20' || (nr && type !== '13') ? (lte ? '5G NSA' : '5G SA') : type === '13' ? '4G' : type;
  const bands: string[] = [];
  if (has(s.Nr_bands)) bands.push(`n${s.Nr_bands}`);
  if (has(s.Lte_bands)) bands.push(`B${s.Lte_bands}`);
  return {
    network, operator: s.network_provider ?? '', bands,
    rsrp: num(nr ? s.nr_rsrp ?? s.Z5g_rsrp : s.lte_rsrp),
    rsrq: num(nr ? s.nr_rsrq : s.lte_rsrq),
    sinr: num(nr ? s.Nr_snr : s.Lte_snr),
    pci: num(nr ? s.Nr_pci : s.Lte_pci),
    bars: Math.max(0, Math.min(4, Math.round(num(s.signalbar)))),
  };
}

/** 短信时间 "yy,MM,dd,HH,mm,ss,+时区"：时区那一段的单位没确认，按手机本地时区解释 */
function smsTime(date: string): number {
  const [y, mo, d, h, mi, s] = String(date).split(',').map(Number);
  return new Date(2000 + y, mo - 1, d, h, mi, s).getTime();
}

function decodeBase64(b64: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), c => c.charCodeAt(0)));
  } catch {
    return '';
  }
}

export function createUfi(endpoint: Endpoint, http: Http, opts: UfiOptions = {}): UfiConnector {
  const base = endpoint.url.replace(/\/+$/, '');
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const lteBands = opts.lteBands ?? F50_LTE_BANDS;

  let auth = endpoint.secret ? ufiAuth(endpoint.secret) : '';
  /** 中兴后台的会话 cookie，经 kano-cookie 头带给 UFI 代理 */
  let cookie = '';
  let sessionOkAt = -Infinity;
  let loginFailedAt = -Infinity;
  let versions: { wa: string; cr: string } | null = null;
  let seq = 0;
  let checking: Promise<void> | null = null;
  let writing: Promise<unknown> = Promise.resolve();

  async function api(method: HttpMethod, path: string, o: { query?: string; body?: string | object; token?: string; timeoutMs?: number } = {}): Promise<HttpResponse> {
    const token = o.token ?? auth;
    if (!token) throw new ConnectorError('auth', '还没有填 UFI-TOOLS 的口令');
    const t = String(now());
    const headers: Record<string, string> = { authorization: token, 'kano-t': t, 'kano-sign': ufiSign(method, path, t) };
    if (cookie) headers['kano-cookie'] = cookie;
    if (typeof o.body === 'string') headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    // UFI 代理会在 URL 末尾再拼一个 "?isTest=false"，污染最后一个参数，所以查询串总以无关的 _= 结尾（前端也是这样）
    const url = base + path + (o.query ? `?${o.query}&_=${t}` : '');
    try {
      return await http({ url, method, headers, body: o.body, timeoutMs: o.timeoutMs });
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'auth') throw new ConnectorError('auth', 'UFI-TOOLS 口令不对', e.status);
      throw e;
    }
  }

  const read = async (query: string) => ((await api('GET', GOFORM_GET, { query })).data ?? {}) as Record<string, any>;
  const savedCookie = async () => String(((await api('GET', '/api/get_cookie')).data as { cookie?: string } | null)?.cookie ?? '').trim();
  const loggedIn = async () => (await read('isTest=false&cmd=loginfo')).loginfo === 'ok';

  /** 用 UFI-TOOLS 里保存的后台密码登录中兴后台（API_Doc.md 3.13 的登录流程第 4–5 步） */
  async function zteLogin() {
    if (now() - loginFailedAt < LOGIN_COOLDOWN_MS) throw new ConnectorError('auth', '中兴后台登录失败，10 分钟后再试');
    const pwd = String(((await api('GET', '/api/get_official_web_password')).data as { pwd?: string } | null)?.pwd ?? '');
    if (!pwd) throw new ConnectorError('auth', '中兴后台未登录：UFI-TOOLS 里保存的会话过期了，也没有保存后台密码');
    const { LD } = await read('isTest=false&cmd=LD');
    if (!LD) throw new ConnectorError('device', '读不到中兴后台的登录随机数');
    const body = new URLSearchParams({ goformId: 'LOGIN_MULTI_USER', isTest: 'false', password: ztePassword(pwd, LD), IP: 'localhost', user: 'admin' }).toString();
    const r = await api('POST', GOFORM_SET, { body });
    const fresh = (r.headers['kano-cookie'] ?? r.headers['set-cookie'] ?? '').split(';')[0].trim();
    const result = String((r.data as { result?: unknown } | null)?.result ?? '');
    if (result === '3' || !fresh) {
      loginFailedAt = now();
      throw new ConnectorError('auth', result === '3' ? '中兴后台密码不对' : '中兴后台登录失败');
    }
    cookie = fresh;
    // 存回 UFI-TOOLS：它的网页后台和我们共用这一个会话，各登各的会互相挤掉
    await api('POST', '/api/set_cookie', { body: { cookie } });
  }

  async function checkSession() {
    const first = cookie === '';
    if (first) cookie = await savedCookie();
    if (!(await loggedIn())) {
      const saved = first ? '' : await savedCookie();
      const changed = saved !== '' && saved !== cookie;
      if (changed) cookie = saved;
      if (!changed || !(await loggedIn())) await zteLogin();
    }
    sessionOkAt = now();
  }

  /** 页面会同时发起好几个读取，检查和登录只做一次，其余的等同一个结果 */
  function ensureSession(): Promise<void> {
    if (now() - sessionOkAt < SESSION_FRESH_MS) return Promise.resolve();
    return (checking ??= checkSession().finally(() => { checking = null; }));
  }

  /** 读 goform 字段。多个字段带 multi_data=1；单个字段和前端一样不带 */
  async function goformGet(fields: string[]): Promise<Record<string, any>> {
    await ensureSession();
    return read(`isTest=false${fields.length > 1 ? '&multi_data=1' : ''}&cmd=${fields.join(',')}`);
  }

  /** RD 是一次性的随机数，两个写操作交叉进行会互相作废，所以排队一个一个来 */
  function goformSet(params: Record<string, string>): Promise<void> {
    const run = writing.then(() => writeOne(params));
    writing = run.catch(() => {});
    return run;
  }

  async function writeOne(params: Record<string, string>): Promise<void> {
    await ensureSession();
    if (!versions) {
      const v = await read('isTest=false&multi_data=1&cmd=Language,cr_version,wa_inner_version');
      if (!v.wa_inner_version || !v.cr_version) throw new ConnectorError('device', '读不到固件版本，没法给写操作签名');
      versions = { wa: v.wa_inner_version, cr: v.cr_version };
    }
    const { RD } = await read('isTest=false&cmd=RD');
    if (!RD) {
      sessionOkAt = -Infinity;
      throw new ConnectorError('device', '读不到写操作的随机数（中兴后台会话可能刚失效，再试一次）');
    }
    const body = new URLSearchParams({ ...params, isTest: 'false', AD: zteAd(versions.wa, versions.cr, RD) }).toString();
    const r = await api('POST', GOFORM_SET, { body, timeoutMs: 15_000 });
    if ((r.data as { result?: unknown } | null)?.result !== 'success') {
      sessionOkAt = -Infinity;
      throw new ConnectorError('device', `设备没有接受 ${params.goformId}`);
    }
  }

  /**
   * UFI 这边没有“不确认就自动恢复”的设备端机制（路由器上的看门狗要等联调验证），
   * 所以由 App 计时：到点没确认就把旧值写回去。只在手机还连得上设备的局域网时有效。
   */
  function rollback(timeout: number, undo: () => Promise<void>): Rollback {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      undo().catch(() => {});
    }, timeout * 1000);
    return {
      id: `ufi-${++seq}`,
      timeout,
      async confirm() { settled = true; clearTimeout(timer); },
      async revert() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await undo();
      },
    };
  }

  async function supportedNr(): Promise<number[]> {
    const r = (await api('GET', '/api/getSupportNrBandList', { query: 'slot=0' })).data as { band_list?: unknown[] } | null;
    return (r?.band_list ?? []).filter((b): b is number => Number.isInteger(b)).sort((a, b) => a - b);
  }

  /** NR 写空值只改配置字段、不解除 modem 的锁频（真机实测），解锁要先写全部频段再写空 */
  async function writeBands(lte: string, nr: string, nrAll: string) {
    await goformSet({ goformId: 'LTE_BAND_LOCK', lte_band_lock: lte });
    if (nr === '') await goformSet({ goformId: 'NR_BAND_LOCK', nr_band_lock: nrAll });
    await goformSet({ goformId: 'NR_BAND_LOCK', nr_band_lock: nr });
  }

  async function readWifi(): Promise<UfiWifi> {
    await ensureSession();
    // 这一条和前端写法保持一致：两个查询名放在一个 cmd 里，不带 multi_data
    const r = await read('cmd=queryWiFiModuleSwitch,queryAccessPointInfo&isTest=false');
    const aps = (r.ResponseList ?? []) as Record<string, string>[];
    const on = String(r.WiFiModuleSwitch) === '1';
    const ap = aps.find(a => String(a.AccessPointSwitchStatus) === '1') ?? aps[0];
    const clients = on ? num((await goformGet(['wifi_access_sta_num'])).wifi_access_sta_num) : 0;
    return { on, ssid: ap?.SSID ?? '', band: String(ap?.ChipIndex ?? '0') === '0' ? '2.4' : '5', hidden: String(ap?.ApBroadcastDisabled) === '1', clients };
  }

  async function currentRat(): Promise<{ rat: Rat; bearer: string }> {
    const bearer = String((await goformGet(['net_select'])).net_select ?? '');
    // 接口类型里没有 3G：4G/3G、仅 3G 都归到 lte
    const rat = (Object.keys(RAT_TO_BEARER) as Rat[]).find(k => RAT_TO_BEARER[k] === bearer) ?? (/WCDMA/.test(bearer) ? 'lte' : 'auto');
    return { rat, bearer };
  }

  return {
    limits: {
      airplane: '飞行模式的接口还没抓到，回家联调后再开放',
      hidden: '隐藏 Wi-Fi 名称要重写整份热点配置，字段还没确认',
      fotaUnblock: 'UFI-TOOLS 只能拦截系统更新，没有取消的接口',
      speedTest: 'UFI-TOOLS 的测速接口参数还没确认，暂时测不了',
    },

    async login(password) {
      const token = ufiAuth(password);
      await api('GET', '/api/baseDeviceInfo', { token });
      auth = token;
    },

    async status(): Promise<UfiStatus> {
      const [info, s] = await Promise.all([
        api('GET', '/api/baseDeviceInfo').then(r => (r.data ?? {}) as Record<string, unknown>),
        goformGet(SIGNAL_FIELDS),
      ]);
      const ppp = String(s.ppp_status ?? '');
      return {
        model: String(info.model ?? ''),
        firmware: String(s.cr_version ?? ''),
        ufiVersion: String(info.app_ver ?? ''),
        uptime: Math.round(num(info.boot_time) / 1000),
        signal: parseSignal(s),
        temps: parseTemps(info, opts.throttleAt ?? 60),
        rate: { down: num(s.realtime_rx_thrpt), up: num(s.realtime_tx_thrpt) },
        dataOn: /connected/.test(ppp) && !/disconnected/.test(ppp),
        pdp: ppp === 'ipv4_ipv6_connected' ? 'IPv4v6' : ppp === 'ipv4_connected' ? 'IPv4' : ppp === 'ipv6_connected' ? 'IPv6' : '',
        roaming: (s.dial_roam_setting_option || s.roam_setting_option) === 'on',
        // 待真机抓包：UFI-TOOLS 没有飞行模式的读接口，airplane 不返回
        // goform 的 monthly_rx/tx_bytes 在 F50 上数值不可信，用 UFI-TOOLS 自己统计的
        monthBytes: num(info.monthly_data),
        todayBytes: num(info.daily_data),
      };
    },

    async bands() {
      const [cur, nr] = await Promise.all([goformGet(['nr_band_lock', 'lte_band_lock']), supportedNr()]);
      return {
        current: { nr: bandNumbers(cur.nr_band_lock).map(b => `n${b}`), lte: bandNumbers(cur.lte_band_lock).map(b => `B${b}`) },
        supported: { nr: nr.map(b => `n${b}`), lte: lteBands.map(b => `B${b}`) },
      };
    },

    async lockBands(lock: BandLock) {
      const nrAll = await supportedNr();
      if (!nrAll.length) throw new ConnectorError('device', '读不到设备支持的 5G 频段，没法保证能解除锁频');
      const nr = parseBands([...lock.nr], 'n', nrAll).join(',');
      const lte = parseBands([...lock.lte], 'B', lteBands).join(',');
      const old = await goformGet(['nr_band_lock', 'lte_band_lock']);
      await writeBands(lte, nr, nrAll.join(','));
      return rollback(60, () => writeBands(String(old.lte_band_lock ?? ''), String(old.nr_band_lock ?? ''), nrAll.join(',')));
    },

    wifi: readWifi,

    async setWifi(patch) {
      // 待真机抓包：隐藏 SSID 要用 setAccessPointInfo 把整份热点配置（含密码）重写一遍，字段取值没确认
      if (patch.hidden !== undefined) throw unsupported('隐藏 Wi-Fi 名称');
      if (patch.on === false) {
        await goformSet({ goformId: 'switchWiFiModule', SwitchOption: '0' });
        return;
      }
      if (patch.on === undefined && patch.band === undefined) return;
      const band = patch.band ?? (await readWifi()).band;
      await goformSet({ goformId: 'switchWiFiChip', ChipEnum: band === '2.4' ? 'chip1' : 'chip2', GuestEnable: '0' });
    },

    async usbMode() {
      return USB_MODES[num((await goformGet(['usb_network_protocal'])).usb_network_protocal)] ?? 'auto';
    },

    async setUsbMode(mode) {
      await goformSet({ goformId: 'SET_USB_NETWORK_PROTOCAL', usb_network_protocal: String(USB_MODES.indexOf(mode)) });
    },

    async rat() {
      return (await currentRat()).rat;
    },

    async setRat(rat) {
      const old = (await currentRat()).bearer;
      await goformSet({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: RAT_TO_BEARER[rat] });
      return rollback(60, () => goformSet({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: old || RAT_TO_BEARER.auto }));
    },

    async setData(on) {
      if (on) {
        await goformSet({ goformId: 'CONNECT_NETWORK' });
        return;
      }
      await goformSet({ goformId: 'DISCONNECT_NETWORK' });
      return rollback(90, () => goformSet({ goformId: 'CONNECT_NETWORK' }));
    },

    async setRoaming(on) {
      const v = on ? 'on' : 'off';
      await goformSet({ goformId: 'SET_CONNECTION_MODE', ConnectionMode: 'auto_dial', roam_setting_option: v, dial_roam_setting_option: v });
    },

    async setAirplane() {
      // 待真机抓包：前端和 API_Doc.md 里都没有飞行模式的接口
      throw unsupported('飞行模式');
    },

    async redial() {
      await goformSet({ goformId: 'DISCONNECT_NETWORK' });
      await sleep(2000);
      await goformSet({ goformId: 'CONNECT_NETWORK' });
    },

    async toggles(): Promise<UfiDeviceToggles> {
      const r = await goformGet(['indicator_light_switch', 'usb_port_switch']);
      // 待真机抓包：拦截系统更新的状态没有读接口，fotaBlock 不返回
      return { led: String(r.indicator_light_switch) === '1', adb: String(r.usb_port_switch) === '1' };
    },

    async setToggle(key, on) {
      const v = on ? '1' : '0';
      if (key === 'led') return goformSet({ goformId: 'INDICATOR_LIGHT_SETTING', indicator_light_switch: v });
      if (key === 'adb') return goformSet({ goformId: 'USB_PORT_SETTING', usb_port_switch: v });
      // 待真机抓包：UFI-TOOLS 只有“禁用系统更新”这一个方向（/api/disable_fota，要 ADB 就绪），没有恢复的接口
      if (!on) throw unsupported('恢复系统更新');
      const r = (await api('GET', '/api/disable_fota', { timeoutMs: 20_000 })).data as { error?: string } | null;
      if (r?.error) throw new ConnectorError('device', r.error);
    },

    async sms() {
      await ensureSession();
      const r = await read(`multi_data=1&isTest=false&cmd=sms_data_total&page=0&data_per_page=500&mem_store=1&tags=100&order_by=${encodeURIComponent('order by id desc')}`);
      // tag：0 已读、1 未读是收到的短信，2/3/4 是发出、发送失败、草稿
      return ((r.messages ?? []) as Record<string, string>[])
        .filter(m => m.tag === '0' || m.tag === '1')
        .map((m): Sms => ({ id: String(m.id), from: m.number ?? '', text: decodeBase64(m.content ?? ''), time: smsTime(m.date), read: m.tag === '0' }));
    },

    async speedTest() {
      // 待真机抓包：/api/speedtest 是流式下载，测的是手机到设备这一段局域网，也没有上行；蜂窝测速前端走 /api/proxy，参数没确认
      throw unsupported('测速');
    },

    async reboot() {
      await goformSet({ goformId: 'REBOOT_DEVICE' });
    },
  };
}
