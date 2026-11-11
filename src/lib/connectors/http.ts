/*
 * 三个连接器共用的 HTTP 封装：
 * - 原生端走 CapacitorHttp（绕开 WebView 的跨域限制），浏览器 dev 下退回 fetch；
 * - 统一超时；网络、超时、鉴权、HTTP 状态错误一律映射成 ConnectorError；
 * - 默认只允许局域网和 Tailscale 地址（PLAN.md 第 7 节），其他地址直接拦下，请求不会发出去。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { ConnectorError } from '../errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** 字符串原样发送（调用方自己设 Content-Type），对象按 JSON 发送 */
  body?: string | object;
  timeoutMs?: number;
  /** 这些非 2xx 状态码不抛错，交给调用方处理 */
  accept?: number[];
  /** 单次放行公网地址。只用于不带任何凭据的请求（出口核对） */
  allowPublic?: boolean;
}

export interface HttpResponse {
  status: number;
  /** 头名统一小写 */
  headers: Record<string, string>;
  /** 响应体是 JSON 时为解析后的值，否则是文本 */
  data: unknown;
}

export interface TransportRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export type Transport = (req: TransportRequest) => Promise<HttpResponse>;
export type Http = (req: HttpRequest) => Promise<HttpResponse>;

export interface HttpOptions {
  /** 测试时传假的传输层 */
  transport?: Transport;
  timeoutMs?: number;
  /** 用户在设置里确认过“允许公网地址”时为 true */
  allowPublic?: boolean;
}

const DEFAULT_TIMEOUT = 8000;

/**
 * local：10/8、172.16/12、192.168/16、100.64/10（Tailscale），IPv6 的 fc00::/7 和 fe80::/10，
 * 以及没法从字面判断、但按惯例只在内网解析的主机名（单标签、.lan、.local、.home.arpa、.internal、Tailscale 的 .ts.net）。
 */
export function addressScope(raw: string): 'local' | 'public' | 'invalid' {
  let u: URL;
  try { u = new URL(raw); } catch { return 'invalid'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid';
  const h = u.hostname.toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (v4) {
    const a = +v4[1], b = +v4[2];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ? 'local' : 'public';
  }
  if (h.startsWith('[')) {
    const first = parseInt(h.slice(1).split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ? 'local' : 'public';
  }
  return !h.includes('.') || /\.(lan|local|home\.arpa|internal|ts\.net)$/.test(h) ? 'local' : 'public';
}

const nativeTransport: Transport = async req => {
  const r = await CapacitorHttp.request({
    url: req.url, method: req.method, headers: req.headers, data: req.body,
    connectTimeout: req.timeoutMs, readTimeout: req.timeoutMs, responseType: 'text',
  });
  return { status: r.status, headers: r.headers ?? {}, data: r.data };
};

const fetchTransport: Transport = async req => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), req.timeoutMs);
  try {
    const r = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctl.signal });
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    return { status: r.status, headers, data: await r.text() };
  } finally {
    clearTimeout(timer);
  }
};

function toConnectorError(e: unknown): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: unknown; name?: unknown; message?: unknown } | null;
  const msg = String(err?.message ?? e);
  // 原生端 reject 时 code 是 Java 异常类名（SocketTimeoutException、ConnectException…）
  if (/timeout|timed out|abort/i.test(`${err?.code ?? ''} ${err?.name ?? ''} ${msg}`)) return new ConnectorError('timeout', '请求超时');
  return new ConnectorError('network', `连接失败：${msg}`);
}

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  const t = data.trim();
  if (!/^[[{"]/.test(t)) return data;
  try { return JSON.parse(t); } catch { return data; }
}

function detail(data: unknown): string {
  const m = typeof data === 'string' ? data : (data as { message?: unknown } | null)?.message;
  return m ? `：${String(m).slice(0, 120)}` : '';
}

export function createHttp(opts: HttpOptions = {}): Http {
  const transport = opts.transport ?? (Capacitor.isNativePlatform() ? nativeTransport : fetchTransport);

  return async req => {
    const scope = addressScope(req.url);
    if (scope === 'invalid') throw new ConnectorError('blocked', `地址不合法：${req.url}`);
    if (scope === 'public' && !opts.allowPublic && !req.allowPublic) {
      throw new ConnectorError('blocked', `默认只允许局域网和 Tailscale 地址：${new URL(req.url).host}`);
    }

    const headers = { ...req.headers };
    let body: string | undefined;
    if (typeof req.body === 'string') {
      body = req.body;
      // 原生端没有 Content-Type 时不会把请求体发出去
      headers['Content-Type'] ??= 'text/plain';
    } else if (req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers['Content-Type'] ??= 'application/json';
    }

    const timeoutMs = req.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ConnectorError('timeout', '请求超时')), timeoutMs);
    });

    let res: HttpResponse;
    try {
      res = await Promise.race([transport({ url: req.url, method: req.method ?? 'GET', headers, body, timeoutMs }), deadline]);
    } catch (e) {
      throw toConnectorError(e);
    } finally {
      clearTimeout(timer);
    }

    const out: HttpResponse = { status: res.status, headers: {}, data: parseBody(res.data) };
    for (const [k, v] of Object.entries(res.headers ?? {})) out.headers[k.toLowerCase()] = String(v);

    if ((out.status >= 200 && out.status < 300) || req.accept?.includes(out.status)) return out;
    if (out.status === 401 || out.status === 403) throw new ConnectorError('auth', `鉴权失败（HTTP ${out.status}）`, out.status);
    throw new ConnectorError('http', `HTTP ${out.status}${detail(out.data)}`, out.status);
  };
}
