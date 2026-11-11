/*
 * 多套配置的持久化。地址、账号、重点线路放普通存储（localStorage）；
 * 密码和 secret 放 SecretStore（安卓上是 Keystore，浏览器 dev 下只在内存里）。
 */
import type { Endpoint, Profile } from './types';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SecretStore {
  /** false：只在内存里，App 重启后要重新输入密码 */
  readonly persistent: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memorySecrets(): SecretStore {
  const m = new Map<string, string>();
  return {
    persistent: false,
    async get(k) { return m.get(k) ?? null; },
    async set(k, v) { m.set(k, v); },
    async remove(k) { m.delete(k); },
  };
}

const KEY = 'homenet.profiles';
const MODULES = ['router', 'mihomo', 'ufi'] as const;
type Module = (typeof MODULES)[number];

interface Saved {
  v: 1;
  list: Profile[];
  current: string | null;
}

const secretKey = (id: string, m: Module) => `homenet.secret.${id}.${m}`;

function strip(p: Profile): Profile {
  const out: Profile = structuredClone(p);
  for (const m of MODULES) {
    const e = out[m] as Endpoint | undefined;
    if (e) delete e.secret;
  }
  return out;
}

export function createProfileStore(kv: KV, secrets: SecretStore, demo: Profile) {
  function read(): Saved {
    try {
      const s = JSON.parse(kv.getItem(KEY) || 'null') as Saved | null;
      if (s && s.v === 1 && Array.isArray(s.list)) return s;
    } catch { /* 损坏当作空 */ }
    return { v: 1, list: [], current: null };
  }
  const write = (s: Saved) => kv.setItem(KEY, JSON.stringify(s));

  return {
    secretsPersistent: secrets.persistent,

    list(): Profile[] {
      return [structuredClone(demo), ...read().list];
    },

    currentId(): string | null {
      const s = read();
      if (s.current === demo.id) return demo.id;
      return s.list.some(p => p.id === s.current) ? s.current : null;
    },

    setCurrent(id: string | null) {
      const s = read();
      s.current = id;
      write(s);
    },

    newId(): string {
      return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    async load(id: string): Promise<Profile> {
      if (id === demo.id) return structuredClone(demo);
      const p = read().list.find(x => x.id === id);
      if (!p) throw new Error(`配置不存在：${id}`);
      for (const m of MODULES) {
        const e = p[m] as Endpoint | undefined;
        if (!e) continue;
        const v = await secrets.get(secretKey(id, m));
        if (v) e.secret = v;
      }
      return p;
    },

    async save(p: Profile) {
      if (p.id === demo.id || p.demo) throw new Error('演示配置是内置的，不能修改');
      for (const m of MODULES) {
        const v = (p[m] as Endpoint | undefined)?.secret;
        if (v) await secrets.set(secretKey(p.id, m), v);
        else await secrets.remove(secretKey(p.id, m));
      }
      const s = read();
      const clean = strip(p);
      const i = s.list.findIndex(x => x.id === p.id);
      if (i >= 0) s.list[i] = clean;
      else s.list.push(clean);
      write(s);
    },

    async remove(id: string) {
      if (id === demo.id) throw new Error('演示配置是内置的，不能删除');
      for (const m of MODULES) await secrets.remove(secretKey(id, m));
      const s = read();
      s.list = s.list.filter(x => x.id !== id);
      if (s.current === id) s.current = null;
      write(s);
    },
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;
