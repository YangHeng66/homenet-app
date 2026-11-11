import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '../../errors';
import { addressScope, createHttp, type Transport } from '../http';

const ok: Transport = async () => ({ status: 200, headers: {}, data: '' });

async function kindOf(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof ConnectorError ? e.kind : `非 ConnectorError: ${e}`; }
  return '没有抛错';
}

describe('addressScope', () => {
  it.each([
    ['http://10.0.0.1', 'local'],
    ['http://172.16.0.1:9090', 'local'],
    ['http://172.31.255.254', 'local'],
    ['http://192.168.8.1/ubus', 'local'],
    ['http://100.64.0.1', 'local'],
    ['http://100.127.255.254:2333', 'local'],
    ['http://[fd7a:115c:a1e0::1]:9090', 'local'],
    ['http://[fe80::1]', 'local'],
    ['http://openwrt.lan', 'local'],
    ['http://router', 'local'],
    ['http://box.tailnet-name.ts.net', 'local'],
    ['http://172.32.0.1', 'public'],
    ['http://100.128.0.1', 'public'],
    ['http://192.169.1.1', 'public'],
    ['http://8.8.8.8', 'public'],
    ['https://example.com', 'public'],
    ['http://[2001:db8::1]', 'public'],
    ['ftp://192.168.1.1', 'invalid'],
    ['192.168.1.1', 'invalid'],
    ['', 'invalid'],
  ])('%s → %s', (url, scope) => {
    expect(addressScope(url)).toBe(scope);
  });
});

describe('createHttp', () => {
  afterEach(() => vi.useRealTimers());

  it('公网地址默认拦截，不发请求', async () => {
    const transport = vi.fn(ok);
    const http = createHttp({ transport });
    expect(await kindOf(http({ url: 'http://8.8.8.8/x' }))).toBe('blocked');
    expect(await kindOf(http({ url: 'javascript:alert(1)' }))).toBe('blocked');
    expect(transport).not.toHaveBeenCalled();
  });

  it('allowPublic 放行（整体或单次）', async () => {
    await expect(createHttp({ transport: ok, allowPublic: true })({ url: 'http://8.8.8.8/x' })).resolves.toMatchObject({ status: 200 });
    await expect(createHttp({ transport: ok })({ url: 'https://example.com/ip', allowPublic: true })).resolves.toMatchObject({ status: 200 });
  });

  it('401/403 → auth，其他非 2xx → http 并带状态码', async () => {
    const http = (status: number) => createHttp({ transport: async () => ({ status, headers: {}, data: '{"message":"boom"}' }) });
    expect(await kindOf(http(401)({ url: 'http://192.168.1.1' }))).toBe('auth');
    expect(await kindOf(http(403)({ url: 'http://192.168.1.1' }))).toBe('auth');
    const e = await http(500)({ url: 'http://192.168.1.1' }).catch(x => x);
    expect(e).toBeInstanceOf(ConnectorError);
    expect(e.kind).toBe('http');
    expect(e.status).toBe(500);
    expect(e.message).toContain('boom');
  });

  it('accept 里的状态码不抛错', async () => {
    const http = createHttp({ transport: async () => ({ status: 504, headers: {}, data: '{"message":"Timeout"}' }) });
    const r = await http({ url: 'http://192.168.1.1', accept: [504] });
    expect(r.status).toBe(504);
    expect(r.data).toEqual({ message: 'Timeout' });
  });

  it('传输层抛错：超时 → timeout，其他 → network', async () => {
    const thrower = (err: unknown) => createHttp({ transport: async () => { throw err; } });
    expect(await kindOf(thrower(Object.assign(new Error('timeout'), { code: 'SocketTimeoutException' }))({ url: 'http://10.0.0.1' }))).toBe('timeout');
    expect(await kindOf(thrower(Object.assign(new Error('aborted'), { name: 'AbortError' }))({ url: 'http://10.0.0.1' }))).toBe('timeout');
    expect(await kindOf(thrower(Object.assign(new Error('Failed to connect to /10.0.0.1:80'), { code: 'ConnectException' }))({ url: 'http://10.0.0.1' }))).toBe('network');
    expect(await kindOf(thrower(new TypeError('Failed to fetch'))({ url: 'http://10.0.0.1' }))).toBe('network');
  });

  it('传输层一直不返回时按统一超时结束', async () => {
    vi.useFakeTimers();
    const http = createHttp({ transport: () => new Promise(() => {}), timeoutMs: 3000 });
    const p = kindOf(http({ url: 'http://10.0.0.1' }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe('timeout');
  });

  it('响应：JSON 文本解析成对象，头名统一小写，非 JSON 保持文本', async () => {
    const http = createHttp({ transport: async () => ({ status: 200, headers: { 'Kano-Cookie': 'a=1; path=/' }, data: ' {"a":1} ' }) });
    const r = await http({ url: 'http://10.0.0.1' });
    expect(r.data).toEqual({ a: 1 });
    expect(r.headers['kano-cookie']).toBe('a=1; path=/');
    const text = createHttp({ transport: async () => ({ status: 200, headers: {}, data: 'ip=1.2.3.4\nloc=US' }) });
    expect((await text({ url: 'http://10.0.0.1' })).data).toBe('ip=1.2.3.4\nloc=US');
    const parsed = createHttp({ transport: async () => ({ status: 200, headers: {}, data: { already: true } }) });
    expect((await parsed({ url: 'http://10.0.0.1' })).data).toEqual({ already: true });
  });

  it('请求体：对象按 JSON 发，字符串原样发，都带 Content-Type', async () => {
    const transport = vi.fn(ok);
    const http = createHttp({ transport });
    await http({ url: 'http://10.0.0.1', method: 'POST', body: { a: 1 } });
    await http({ url: 'http://10.0.0.1', method: 'POST', body: 'a=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    await http({ url: 'http://10.0.0.1' });
    expect(transport.mock.calls[0][0]).toMatchObject({ method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    expect(transport.mock.calls[1][0]).toMatchObject({ body: 'a=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(transport.mock.calls[2][0]).toMatchObject({ method: 'GET', timeoutMs: 8000 });
    expect(transport.mock.calls[2][0].body).toBeUndefined();
  });
});
