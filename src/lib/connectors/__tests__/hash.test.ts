import { describe, expect, it } from 'vitest';
import { hex, hmacMd5, md5, sha256, utf8 } from '../hash';

/* 期望值由 Node 自带的 crypto 模块算出（生成脚本：scripts/ufi-sign-vectors.mjs）。 */
describe('hash', () => {
  it('md5', () => {
    expect(hex(md5(utf8('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(utf8('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(md5(utf8('a'.repeat(200))))).toBe('887f30b43b2867f4a9accceee7d16e6c');
  });

  it('sha256', () => {
    expect(hex(sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(utf8('中文'.repeat(40))))).toBe('02edd7ebacb868274987a7258f1a56ebd8fae17427e20c43c005e4e1a63b794e');
  });

  it('hmac-md5（RFC 2202 用例 2）', () => {
    expect(hex(hmacMd5(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe('750c783e6ab0b503eaa86e310a5db738');
  });
});
