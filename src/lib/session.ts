/*
 * 一次“会话”= 一套配置创建出的连接器。切换配置后旧会话里还没回来的请求结果一律作废，
 * 免得写进新配置的快照。
 */
import type { Connectors } from './types';
import { ConnectorError, type ConnectorErrorKind } from './errors';

export class StaleError extends Error {
  readonly stale = true;
  constructor() { super('配置已切换'); }
}

const MODULE_KEYS = ['router', 'mihomo', 'ufi', 'plugin'] as const;

function wrap<T extends object>(target: T, alive: () => boolean): T {
  return new Proxy(target, {
    get(t, k, recv) {
      const v = Reflect.get(t, k, recv);
      if (typeof v !== 'function') return v;
      return async (...args: unknown[]) => {
        if (!alive()) throw new StaleError();
        const r = await v.apply(t, args);
        if (!alive()) throw new StaleError();
        return r;
      };
    },
  });
}

export function fence<C extends Connectors>(c: C, alive: () => boolean): C {
  const out = { ...c };
  for (const k of MODULE_KEYS) {
    const m = c[k];
    if (m) (out as Connectors)[k] = wrap(m as object, alive) as never;
  }
  return out;
}

export type ModuleKey = 'router' | 'mihomo' | 'ufi';
export const MODULE_NAME: Record<ModuleKey, string> = { router: '路由器', mihomo: '代理', ufi: 'F50' };

export interface ErrorView {
  kind: ConnectorErrorKind | 'unknown';
  title: string;
  hint: string;
  /** retry：重试；edit：去改配置；none：没有可做的 */
  action: 'retry' | 'edit' | 'none';
}

const AUTH: Record<ModuleKey, string> = { router: '路由器密码不对', mihomo: '代理的 API secret 不对', ufi: 'UFI-TOOLS 口令不对' };
const API_HINT: Record<ModuleKey, string> = {
  router: '确认地址是路由器的 LuCI 地址，并且装了 uhttpd-mod-ubus（访问 /ubus）',
  mihomo: '确认端口是 mihomo 的外部控制端口（external-controller）',
  ufi: '确认端口是 UFI-TOOLS 的端口（默认 2333）',
};

export function describeError(e: unknown, m: ModuleKey): ErrorView {
  const name = MODULE_NAME[m];
  const sp = /^[A-Za-z0-9]/.test(name) ? ' ' : '';
  if (!(e instanceof ConnectorError)) return { kind: 'unknown', title: `${name}出错`, hint: e instanceof Error ? e.message : String(e), action: 'retry' };
  switch (e.kind) {
    case 'network': return { kind: e.kind, title: `连不上${name}`, hint: '确认手机连着家里的网络；在外面时先打开 Tailscale', action: 'retry' };
    case 'timeout': return { kind: e.kind, title: `${name}${sp}没有响应`, hint: '设备可能正在重启，或者地址、端口填错了', action: 'retry' };
    case 'auth': return { kind: e.kind, title: AUTH[m], hint: '到配置里重新填写；浏览器调试时密码只存在内存里，刷新后要重填', action: 'edit' };
    case 'blocked': return { kind: e.kind, title: `${name}地址被拦下`, hint: `${e.message}。公网地址是明文 HTTP，要在配置里确认风险后才放行`, action: 'edit' };
    case 'http': return { kind: e.kind, title: `${name}返回错误`, hint: `${e.message}。${API_HINT[m]}`, action: 'edit' };
    case 'unsupported': return { kind: e.kind, title: '暂不支持', hint: e.message, action: 'none' };
    case 'device': return { kind: e.kind, title: `${name}报错`, hint: e.message, action: 'retry' };
  }
}

/** 模块连续失败时拉长重试间隔（5 秒起翻倍，最长 60 秒），免得离线时每拍都等满超时 */
export class Backoff {
  private s: Partial<Record<ModuleKey, { until: number; ms: number }>> = {};
  constructor(private now: () => number = Date.now) {}
  ready(m: ModuleKey) { return !this.s[m] || this.now() >= this.s[m].until; }
  /** 返回 true 表示这是一轮连续失败里的第一次 */
  fail(m: ModuleKey): boolean {
    const prev = this.s[m];
    const ms = prev ? Math.min(60_000, prev.ms * 2) : 5000;
    this.s[m] = { until: this.now() + ms, ms };
    return !prev;
  }
  ok(m: ModuleKey) { delete this.s[m]; }
  clear() { this.s = {}; }
}
