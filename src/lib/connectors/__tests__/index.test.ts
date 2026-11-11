import { describe, expect, it } from 'vitest';
import { createConnectors } from '../index';
import type { Profile } from '../../types';
import { fakeNet } from './fake-net';

const profile: Profile = {
  id: 'home', name: '家里', demo: false, keyLines: [],
  router: { url: 'http://192.168.1.1', username: 'root', secret: 'pw' },
  mihomo: { url: 'http://192.168.1.1:9090', secret: 's', kind: 'nikki' },
};

describe('createConnectors', () => {
  it('只创建配置里填了的模块，共用一个 HTTP 层', async () => {
    const { http, calls } = fakeNet(() => ({ version: 'v1.19.15', meta: true }));
    const c = createConnectors(profile, { http });
    expect(c.profile).toBe(profile);
    expect(c.router).toBeDefined();
    expect(c.ufi).toBeUndefined();
    expect(c.plugin).toBeUndefined();
    await c.mihomo!.version();
    expect(calls[0].url).toBe('http://192.168.1.1:9090/version');
  });

  it('默认拦截公网地址，allowPublic 放行到传输层', async () => {
    const pub: Profile = { ...profile, router: undefined, mihomo: { url: 'http://203.0.113.5:9090', kind: 'mihomo' } };
    await expect(createConnectors(pub).mihomo!.version()).rejects.toMatchObject({ kind: 'blocked' });
  });
});
