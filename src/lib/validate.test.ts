import { describe, expect, it } from 'vitest';
import { isHostname, normalizeUrl, parseDomains } from './validate';

describe('isHostname', () => {
  it.each(['tv', 'Living-Room-TV', 'pc01', 'a'.repeat(63)])('%s 合法', v => expect(isHostname(v)).toBe(true));
  it.each(['', '客厅电视', 'my tv', '-tv', 'tv-', 'tv_1', 'a.b', 'a'.repeat(64)])('%j 不合法', v => expect(isHostname(v)).toBe(false));
});

describe('normalizeUrl', () => {
  it.each([
    ['192.168.1.1', undefined, 'http://192.168.1.1'],
    ['  192.168.1.1/ ', undefined, 'http://192.168.1.1'],
    ['http://192.168.1.1/', undefined, 'http://192.168.1.1'],
    ['192.168.1.1', 9090, 'http://192.168.1.1:9090'],
    ['192.168.1.1:9091', 9090, 'http://192.168.1.1:9091'],
    ['https://router.lan', undefined, 'https://router.lan'],
    ['router.lan/cgi-bin/luci', undefined, 'http://router.lan/cgi-bin/luci'],
    ['[fd00::1]', 2333, 'http://[fd00::1]:2333'],
  ])('%j（默认端口 %s）→ %s', (raw, port, want) => expect(normalizeUrl(raw, port)).toBe(want));

  it.each(['', '   ', 'ftp://x', 'http://', 'a b'])('%j → null', raw => expect(normalizeUrl(raw)).toBeNull());
});

describe('parseDomains', () => {
  it('逗号、空格、换行分隔，去重，去掉协议和路径', () => {
    expect(parseDomains('claude.ai, https://anthropic.com/x\nclaude.ai  openai.com,')).toEqual(['claude.ai', 'anthropic.com', 'openai.com']);
  });
  it('空输入返回空数组', () => expect(parseDomains('  ')).toEqual([]));
});
