/*
 * 配置分享文本（二维码里放的就是它）：
 *   homenet:1:<base64url(JSON)>                     不含密码
 *   homenet:1e:<base64url(盐16 | IV12 | 密文)>       含密码，PBKDF2-SHA256 派生 AES-GCM 密钥
 * 导入方是系统边界：逐字段校验，只取认识的字段。
 */
import type { Endpoint, KeyLine, MihomoKind, Profile } from './types';
import { addressScope } from './connectors/http';

export type SharedProfile = Pick<Profile, 'name' | 'router' | 'mihomo' | 'ufi' | 'keyLines'>;
export type DecodeResult =
  | { ok: true; encrypted: boolean; profile: SharedProfile }
  | { ok: false; reason: 'need-pass' | 'bad-pass' | 'invalid' };

const PLAIN = 'homenet:1:';
const ENC = 'homenet:1e:';
const ITER = 150_000;
export const MIN_PASS = 6;

const te = new TextEncoder();
const td = new TextDecoder();

function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function key(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function pick(p: Profile | SharedProfile, withSecrets: boolean): SharedProfile {
  const ep = <T extends Endpoint>(e: T | undefined): T | undefined => {
    if (!e) return undefined;
    const out = { ...e };
    if (!withSecrets || !out.secret) delete out.secret;
    return out;
  };
  const out: SharedProfile = { name: p.name, keyLines: p.keyLines.map(k => ({ ...k, domains: [...k.domains] })) };
  if (p.router) out.router = ep(p.router);
  if (p.mihomo) out.mihomo = ep(p.mihomo);
  if (p.ufi) out.ufi = ep(p.ufi);
  return out;
}

export async function encodeProfile(p: Profile | SharedProfile, passphrase?: string): Promise<string> {
  if (passphrase === undefined) return PLAIN + b64u(te.encode(JSON.stringify(pick(p, false))));
  if (passphrase.length < MIN_PASS) throw new Error(`口令至少 ${MIN_PASS} 位`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(passphrase, salt), te.encode(JSON.stringify(pick(p, true)))));
  const all = new Uint8Array(salt.length + iv.length + ct.length);
  all.set(salt); all.set(iv, 16); all.set(ct, 28);
  return ENC + b64u(all);
}

export const isShareText = (t: string) => /^homenet:1e?:/.test(t.replace(/\s+/g, ''));

const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || str(v);
const KINDS: MihomoKind[] = ['nikki', 'openclash', 'mihomo'];

function endpoint(v: unknown): Endpoint | undefined {
  if (v === undefined) return undefined;
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !str(o.url) || addressScope(o.url) === 'invalid') throw new Error('bad endpoint');
  if (!optStr(o.username) || !optStr(o.secret)) throw new Error('bad endpoint');
  const e: Endpoint = { url: o.url };
  if (o.username) e.username = o.username as string;
  if (o.secret) e.secret = o.secret as string;
  return e;
}

function keyLine(v: unknown): KeyLine {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !str(o.id) || !str(o.name) || !str(o.group)) throw new Error('bad keyline');
  if (!optStr(o.expectIp) || !optStr(o.checkUrl) || !Array.isArray(o.domains) || !o.domains.every(str)) throw new Error('bad keyline');
  if (o.checkUrl && addressScope(o.checkUrl as string) === 'invalid') throw new Error('bad keyline');
  const k: KeyLine = { id: o.id, name: o.name, group: o.group, domains: [...(o.domains as string[])] };
  if (o.expectIp) k.expectIp = o.expectIp as string;
  if (o.checkUrl) k.checkUrl = o.checkUrl as string;
  return k;
}

function validate(v: unknown): SharedProfile {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !str(o.name) || !Array.isArray(o.keyLines)) throw new Error('bad profile');
  const out: SharedProfile = { name: o.name.slice(0, 40), keyLines: o.keyLines.map(keyLine) };
  const r = endpoint(o.router), u = endpoint(o.ufi), m = endpoint(o.mihomo);
  if (r) out.router = r;
  if (m) {
    const kind = (o.mihomo as Record<string, unknown>).kind;
    if (!KINDS.includes(kind as MihomoKind)) throw new Error('bad kind');
    out.mihomo = { ...m, kind: kind as MihomoKind };
  }
  if (u) out.ufi = u;
  if (!out.router && !out.mihomo && !out.ufi) throw new Error('empty');
  return out;
}

export async function decodeProfile(text: string, passphrase?: string): Promise<DecodeResult> {
  const t = text.replace(/\s+/g, '');
  if (t.startsWith(ENC)) {
    let bytes: Uint8Array;
    try { bytes = unb64u(t.slice(ENC.length)); } catch { return { ok: false, reason: 'invalid' }; }
    if (bytes.length < 29) return { ok: false, reason: 'invalid' };
    if (!passphrase) return { ok: false, reason: 'need-pass' };
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(16, 28) }, await key(passphrase, bytes.slice(0, 16)), bytes.slice(28));
    } catch { return { ok: false, reason: 'bad-pass' }; }
    try { return { ok: true, encrypted: true, profile: validate(JSON.parse(td.decode(plain))) }; } catch { return { ok: false, reason: 'invalid' }; }
  }
  if (t.startsWith(PLAIN)) {
    try { return { ok: true, encrypted: false, profile: pick(validate(JSON.parse(td.decode(unb64u(t.slice(PLAIN.length))))), false) }; } catch { return { ok: false, reason: 'invalid' }; }
  }
  return { ok: false, reason: 'invalid' };
}
