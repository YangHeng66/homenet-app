import { beforeEach, describe, expect, it } from 'vitest';
import { createProfileStore, memorySecrets, type KV, type SecretStore } from './profiles';
import type { Profile } from './types';

const DEMO: Profile = { id: 'demo', name: '演示模式', demo: true, keyLines: [] };

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) };
}

const home: Profile = {
  id: 'p1', name: '家', demo: false,
  router: { url: 'http://192.168.1.1', username: 'root', secret: 'router-pass' },
  mihomo: { url: 'http://192.168.1.1:9090', kind: 'nikki', secret: 'api-secret' },
  ufi: { url: 'http://192.168.0.1:2333', secret: 'ufi-pass' },
  keyLines: [{ id: 'k', name: '专线', group: 'G', domains: ['example.com'] }],
};

describe('配置存储', () => {
  let kv: ReturnType<typeof memoryKV>;
  let secrets: SecretStore;
  beforeEach(() => { kv = memoryKV(); secrets = memorySecrets(); });

  it('首次打开没有当前配置，列表里只有内置演示', () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    expect(ps.currentId()).toBeNull();
    expect(ps.list().map(p => p.id)).toEqual(['demo']);
  });

  it('保存时密码和 secret 不进普通存储，读回来时补上', async () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    await ps.save(home);
    const raw = [...kv.data.values()].join('\n');
    expect(raw).not.toContain('router-pass');
    expect(raw).not.toContain('api-secret');
    expect(raw).not.toContain('ufi-pass');
    expect(raw).toContain('192.168.1.1');
    expect(await ps.load('p1')).toEqual(home);
  });

  it('list 返回不带密码的配置，演示排第一', async () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    await ps.save(home);
    const list = ps.list();
    expect(list.map(p => p.id)).toEqual(['demo', 'p1']);
    expect(list[1].router).toEqual({ url: 'http://192.168.1.1', username: 'root' });
    expect(list[1].mihomo?.secret).toBeUndefined();
  });

  it('重新创建（App 重启）后配置和当前选中仍在', async () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    await ps.save(home);
    ps.setCurrent('p1');
    const again = createProfileStore(kv, secrets, DEMO);
    expect(again.currentId()).toBe('p1');
    expect((await again.load('p1')).router?.secret).toBe('router-pass');
  });

  it('修改时去掉模块或清空密码，对应的 secret 一起删掉', async () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    await ps.save(home);
    await ps.save({ ...home, ufi: undefined, mihomo: { ...home.mihomo!, secret: '' } });
    expect(await secrets.get('homenet.secret.p1.ufi')).toBeNull();
    expect(await secrets.get('homenet.secret.p1.mihomo')).toBeNull();
    const p = await ps.load('p1');
    expect(p.ufi).toBeUndefined();
    expect(p.mihomo?.secret).toBeUndefined();
    expect(p.router?.secret).toBe('router-pass');
  });

  it('同 id 保存是修改，不新增', async () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    await ps.save(home);
    await ps.save({ ...home, name: '老家' });
    expect(ps.list().map(p => p.name)).toEqual(['演示模式', '老家']);
  });

  it('删除配置连同 secret；删的是当前配置时清空当前选中', async () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    await ps.save(home);
    ps.setCurrent('p1');
    await ps.remove('p1');
    expect(ps.list().map(p => p.id)).toEqual(['demo']);
    expect(ps.currentId()).toBeNull();
    expect(await secrets.get('homenet.secret.p1.router')).toBeNull();
  });

  it('演示配置不能删、不能覆盖，load 拿到的是副本', async () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    await expect(ps.remove('demo')).rejects.toThrow();
    await expect(ps.save({ ...DEMO, name: 'x' })).rejects.toThrow();
    const d = await ps.load('demo');
    d.name = '改了';
    expect(ps.list()[0].name).toBe('演示模式');
  });

  it('load 不存在的 id 抛错；当前选中指向已不存在的配置时视为没有', async () => {
    kv.setItem('homenet.profiles', JSON.stringify({ v: 1, list: [], current: 'gone' }));
    const ps = createProfileStore(kv, secrets, DEMO);
    expect(ps.currentId()).toBeNull();
    await expect(ps.load('gone')).rejects.toThrow();
  });

  it('普通存储里的数据损坏时当作空', () => {
    kv.setItem('homenet.profiles', '{not json');
    const ps = createProfileStore(kv, secrets, DEMO);
    expect(ps.list().map(p => p.id)).toEqual(['demo']);
  });

  it('newId 不重复', () => {
    const ps = createProfileStore(kv, secrets, DEMO);
    const ids = new Set(Array.from({ length: 50 }, () => ps.newId()));
    expect(ids.size).toBe(50);
  });

  it('内存 secret 存储标记为不持久', () => {
    expect(memorySecrets().persistent).toBe(false);
  });
});
