import { describe, expect, it } from 'vitest';
import { buildProfile, formFrom, hasModule, publicUrls } from './wizard';
import type { Profile } from './types';

const base: Profile = {
  id: 'p1', name: '家', demo: false, allowPublic: false,
  router: { url: 'http://192.168.1.1', username: 'root', secret: 'pw' },
  mihomo: { url: 'http://192.168.1.1:9090', kind: 'nikki', secret: 's' },
  ufi: { url: 'http://192.168.0.1:2333', secret: 'u' },
  keyLines: [
    { id: 'k1', name: '专线', group: 'G', expectIp: '203.0.113.9', checkUrl: 'https://ip.example.com/json', domains: ['example.com', 'example.org'] },
    { id: 'k2', name: '第二条', group: 'H', domains: [] },
  ],
};

describe('向导表单', () => {
  it('从已有配置填表再生成，结果不变（编辑时什么都不改）', () => {
    expect(buildProfile(formFrom(base), 'p1')).toEqual(base);
  });

  it('新建时的默认值：路由器开、账号 root，其他关', () => {
    const f = formFrom();
    expect(f.router).toMatchObject({ on: true, url: '', username: 'root' });
    expect(f.mihomo.on).toBe(false);
    expect(f.ufi.on).toBe(false);
    expect(f.keyLine.on).toBe(false);
  });

  it('只填 IP 时补协议和默认端口（mihomo 9090、UFI 2333）', () => {
    const f = formFrom();
    f.router.url = '10.0.8.1';
    f.router.password = 'x';
    f.mihomo = { on: true, url: '10.0.8.1', secret: '', kind: 'mihomo' };
    f.ufi = { on: true, url: '192.168.0.1', password: 'y' };
    const p = buildProfile(f, 'n');
    expect(p.router?.url).toBe('http://10.0.8.1');
    expect(p.mihomo?.url).toBe('http://10.0.8.1:9090');
    expect(p.ufi?.url).toBe('http://192.168.0.1:2333');
    expect(p.mihomo?.secret).toBeUndefined();
  });

  it('关掉的模块不进配置；名字为空时给默认名', () => {
    const f = formFrom(base);
    f.ufi.on = false;
    f.keyLine.on = false;
    f.name = '  ';
    const p = buildProfile(f, 'p1');
    expect(p.ufi).toBeUndefined();
    expect(p.keyLines.map(k => k.id)).toEqual(['k2']);
    expect(p.name).toBe('我的网络');
  });

  it('重点线路：新建时生成 id，域名按分隔符拆开，空的期望 IP 不写', () => {
    const f = formFrom();
    f.router.url = '10.0.0.1';
    f.keyLine = { on: true, group: '节点选择', name: '', expectIp: ' ', checkUrl: '', domains: 'a.com, b.com\nc.com' };
    const k = buildProfile(f, 'n').keyLines[0];
    expect(k).toMatchObject({ name: '节点选择', group: '节点选择', domains: ['a.com', 'b.com', 'c.com'] });
    expect(k.id).toBeTruthy();
    expect(k.expectIp).toBeUndefined();
    expect(k.checkUrl).toBeUndefined();
  });

  it('地址填不成合法网址时报出是哪一项', () => {
    const f = formFrom();
    f.router.url = 'a b';
    expect(() => buildProfile(f, 'n')).toThrow(/路由器/);
  });

  it('publicUrls 只列出开着的模块里的公网地址', () => {
    const f = formFrom(base);
    expect(publicUrls(f)).toEqual([]);
    f.mihomo.url = 'http://203.0.113.5:9090';
    f.ufi.url = 'http://198.51.100.7:2333';
    f.ufi.on = false;
    expect(publicUrls(f)).toEqual(['http://203.0.113.5:9090']);
  });

  it('hasModule：至少开一个设备模块', () => {
    const f = formFrom();
    expect(hasModule(f)).toBe(false);
    f.router.url = '192.168.1.1';
    expect(hasModule(f)).toBe(true);
  });
});
