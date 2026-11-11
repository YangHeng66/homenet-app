import { describe, expect, it } from 'vitest';
import { Backoff, describeError, fence } from './session';
import { ConnectorError } from './errors';
import type { Connectors, MihomoConnector, Profile } from './types';

const profile: Profile = { id: 'p', name: 'p', demo: false, keyLines: [] };

describe('fence：切换配置后旧连接器的结果作废', () => {
  it('还在用时原样返回', async () => {
    const c = fence({ profile, mihomo: { getMode: async () => 'rule' } as unknown as MihomoConnector }, () => true);
    expect(await c.mihomo!.getMode()).toBe('rule');
  });

  it('请求发出后配置被切走，结果不交给界面', async () => {
    let alive = true;
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const c = fence({ profile, mihomo: { getMode: async () => { await gate; return 'rule'; } } as unknown as MihomoConnector }, () => alive);
    const p = c.mihomo!.getMode();
    alive = false;
    release();
    await expect(p).rejects.toMatchObject({ stale: true });
  });

  it('已经作废后再调用直接拒绝，不发请求', async () => {
    let called = 0;
    const c = fence({ profile, mihomo: { getMode: async () => { called++; return 'rule'; } } as unknown as MihomoConnector }, () => false);
    await expect(c.mihomo!.getMode()).rejects.toMatchObject({ stale: true });
    expect(called).toBe(0);
  });

  it('没有的模块保持 undefined，非函数属性和 this 不受影响', async () => {
    const ufi = { limits: { airplane: 'x' }, n: 2, async get() { return this.n; } };
    const c = fence({ profile, ufi: ufi as never } as Connectors, () => true);
    expect(c.router).toBeUndefined();
    expect((c.ufi as unknown as typeof ufi).limits).toEqual({ airplane: 'x' });
    expect(await (c.ufi as unknown as typeof ufi).get()).toBe(2);
    expect(c.profile).toBe(profile);
  });

  it('原来的错误照样抛出', async () => {
    const c = fence({ profile, mihomo: { getMode: async () => { throw new ConnectorError('auth', 'x'); } } as unknown as MihomoConnector }, () => true);
    await expect(c.mihomo!.getMode()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('describeError', () => {
  it('连不上：提示检查网络和 Tailscale，可重试', () => {
    const d = describeError(new ConnectorError('network', '连接失败：x'), 'router');
    expect(d).toMatchObject({ kind: 'network', title: '连不上路由器', action: 'retry' });
    expect(d.hint).toMatch(/Tailscale/);
  });

  it('超时', () => {
    expect(describeError(new ConnectorError('timeout', '请求超时'), 'ufi')).toMatchObject({ title: 'F50 没有响应', action: 'retry' });
  });

  it('鉴权失败按模块说清楚是哪个密码，引导去改配置', () => {
    expect(describeError(new ConnectorError('auth', ''), 'router').title).toBe('路由器密码不对');
    expect(describeError(new ConnectorError('auth', ''), 'mihomo').title).toBe('代理的 API secret 不对');
    expect(describeError(new ConnectorError('auth', ''), 'ufi').title).toBe('UFI-TOOLS 口令不对');
    expect(describeError(new ConnectorError('auth', ''), 'ufi').action).toBe('edit');
  });

  it('地址被拦：说明默认只连局域网和 Tailscale', () => {
    const d = describeError(new ConnectorError('blocked', '默认只允许局域网和 Tailscale 地址：x'), 'mihomo');
    expect(d).toMatchObject({ kind: 'blocked', action: 'edit' });
    expect(d.hint).toMatch(/公网/);
  });

  it('HTTP 错误带上状态码和原因', () => {
    const d = describeError(new ConnectorError('http', 'HTTP 404', 404), 'router');
    expect(d.title).toBe('路由器返回错误');
    expect(d.hint).toMatch(/HTTP 404/);
    expect(d.hint).toMatch(/ubus/);
  });

  it('设备报错、不支持、未知错误', () => {
    expect(describeError(new ConnectorError('device', 'ubus 错误 -32002'), 'router')).toMatchObject({ title: '路由器报错', hint: 'ubus 错误 -32002' });
    expect(describeError(new ConnectorError('unsupported', '飞行模式待抓包'), 'ufi')).toMatchObject({ title: '暂不支持', action: 'none' });
    expect(describeError(new Error('boom'), 'router')).toMatchObject({ kind: 'unknown', title: '路由器出错', hint: 'boom' });
  });
});

describe('Backoff：失败的模块暂停重试', () => {
  it('失败后在等待期内跳过，过期后再试；成功后清零', () => {
    let now = 0;
    const b = new Backoff(() => now);
    expect(b.ready('router')).toBe(true);
    expect(b.fail('router')).toBe(true);
    expect(b.ready('router')).toBe(false);
    now = 4999;
    expect(b.ready('router')).toBe(false);
    now = 5000;
    expect(b.ready('router')).toBe(true);
    expect(b.fail('router')).toBe(false);
    now = 5000 + 9999;
    expect(b.ready('router')).toBe(false);
    now = 5000 + 10000;
    expect(b.ready('router')).toBe(true);
    b.ok('router');
    b.fail('router');
    now += 5000;
    expect(b.ready('router')).toBe(true);
  });

  it('等待时间最长 60 秒，各模块互不影响，clear 立即恢复', () => {
    let now = 0;
    const b = new Backoff(() => now);
    for (let i = 0; i < 10; i++) { b.fail('ufi'); now += 60_000; }
    b.fail('ufi');
    now += 59_999;
    expect(b.ready('ufi')).toBe(false);
    now += 1;
    expect(b.ready('ufi')).toBe(true);
    expect(b.ready('mihomo')).toBe(true);
    b.fail('ufi');
    b.clear();
    expect(b.ready('ufi')).toBe(true);
  });
});
