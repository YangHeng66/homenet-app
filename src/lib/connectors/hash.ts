/*
 * MD5 / SHA-256 / HMAC-MD5 的同步实现，只给 UFI-TOOLS 签名用。
 * 不用 crypto.subtle：它没有 MD5，而且只在安全上下文里可用。
 */

const encoder = new TextEncoder();
export const utf8 = (s: string): Uint8Array => encoder.encode(s);
export const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 补位到 64 字节的整数倍：0x80、若干 0、最后 8 字节是消息的比特长度 */
function pad(msg: Uint8Array, littleEndian: boolean): DataView {
  const buf = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  const lo = (msg.length << 3) >>> 0, hi = Math.floor(msg.length / 0x20000000);
  dv.setUint32(buf.length - 8, littleEndian ? lo : hi, littleEndian);
  dv.setUint32(buf.length - 4, littleEndian ? hi : lo, littleEndian);
  return dv;
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

const MD5_K = Uint32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

export function md5(msg: Uint8Array): Uint8Array {
  const dv = pad(msg, true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let o = 0; o < dv.byteLength; o += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      f = (f + a + MD5_K[i] + dv.getUint32(o + g * 4, true)) | 0;
      a = d; d = c; c = b;
      b = (b + rotl(f, MD5_S[(i >> 4) * 4 + (i % 4)])) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return new Uint8Array(out.buffer);
}

function primes(n: number): number[] {
  const out: number[] = [];
  for (let c = 2; out.length < n; c++) if (out.every(p => c % p)) out.push(c);
  return out;
}
const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 0x100000000);
const SHA_K = Uint32Array.from(primes(64), p => frac32(Math.cbrt(p)));
const SHA_H = primes(8).map(p => frac32(Math.sqrt(p)));

export function sha256(msg: Uint8Array): Uint8Array {
  const dv = pad(msg, false);
  const h = Uint32Array.from(SHA_H);
  const w = new Uint32Array(64);
  for (let o = 0; o < dv.byteLength; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new DataView(new ArrayBuffer(32));
  h.forEach((v, i) => out.setUint32(i * 4, v));
  return new Uint8Array(out.buffer);
}

export function hmacMd5(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? md5(key) : key);
  return md5(concat(k.map(x => x ^ 0x5c), md5(concat(k.map(x => x ^ 0x36), msg))));
}
