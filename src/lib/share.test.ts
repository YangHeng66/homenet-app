import { describe, expect, it } from 'vitest';
import { decodeProfile, encodeProfile, isShareText } from './share';
import type { Profile } from './types';

const p: Profile = {
  id: 'p1', name: '家', demo: false, allowPublic: true,
  router: { url: 'http://192.168.1.1', username: 'root', secret: 'router-pass' },
  mihomo: { url: 'http://192.168.1.1:9090', kind: 'nikki', secret: 'api-secret' },
  ufi: { url: 'http://192.168.0.1:2333', secret: 'ufi-pass' },
  keyLines: [{ id: 'k', name: '专线', group: 'G', expectIp: '203.0.113.9', checkUrl: 'https://ip.example.com/json', domains: ['example.com'] }],
};

describe('配置导入导出', () => {
  it('默认不含密码，也不带 id、演示标记和公网放行', async () => {
    const text = await encodeProfile(p);
    expect(isShareText(text)).toBe(true);
    expect(text).not.toContain('router-pass');
    const r = await decodeProfile(text);
    expect(r).toEqual({
      ok: true,
      encrypted: false,
      profile: {
        name: '家',
        router: { url: 'http://192.168.1.1', username: 'root' },
        mihomo: { url: 'http://192.168.1.1:9090', kind: 'nikki' },
        ufi: { url: 'http://192.168.0.1:2333' },
        keyLines: p.keyLines,
      },
    });
  });

  it('带密码时用口令加密，原文里看不到任何地址和密码', async () => {
    const text = await encodeProfile(p, 'correct horse');
    expect(text).not.toContain('192.168');
    expect(atob(text.split(':').pop()!.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('router-pass');
    const r = await decodeProfile(text, 'correct horse');
    expect(r.ok && r.encrypted && r.profile.router?.secret).toBe('router-pass');
    expect(r.ok && r.profile.mihomo?.secret).toBe('api-secret');
    expect(r.ok && r.profile.ufi?.secret).toBe('ufi-pass');
  });

  it('加密的配置没给口令时要求输入，口令错了明确报错', async () => {
    const text = await encodeProfile(p, 'correct horse');
    expect(await decodeProfile(text)).toEqual({ ok: false, reason: 'need-pass' });
    expect(await decodeProfile(text, 'wrong')).toEqual({ ok: false, reason: 'bad-pass' });
  });

  it('每次加密结果不同（随机盐和 IV）', async () => {
    expect(await encodeProfile(p, 'pw123456')).not.toBe(await encodeProfile(p, 'pw123456'));
  });

  it('口令太短拒绝加密', async () => {
    await expect(encodeProfile(p, '123')).rejects.toThrow(/至少/);
  });

  it('前后空白、换行（聊天软件里复制）能识别', async () => {
    const text = await encodeProfile(p);
    const r = await decodeProfile(`\n  ${text.slice(0, 20)}\n${text.slice(20)}  `);
    expect(r.ok).toBe(true);
  });

  it.each([
    ['不是 HomeNet 的文本', 'hello'],
    ['前缀对但内容坏了', 'homenet:1:!!!'],
    ['不认识的版本', 'homenet:9:abc'],
  ])('%s → invalid', async (_, text) => {
    expect(await decodeProfile(text)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('结构不对的内容拒绝导入（地址不合法、字段类型不对）', async () => {
    const enc = (o: unknown) => 'homenet:1:' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await decodeProfile(enc({ name: 'x', router: { url: 'javascript:alert(1)' }, keyLines: [] }))).toEqual({ ok: false, reason: 'invalid' });
    expect(await decodeProfile(enc({ name: 1, keyLines: [] }))).toEqual({ ok: false, reason: 'invalid' });
    expect(await decodeProfile(enc({ name: 'x', keyLines: [{ name: 'a' }] }))).toEqual({ ok: false, reason: 'invalid' });
    expect(await decodeProfile(enc({ name: 'x', mihomo: { url: 'http://10.0.0.1:9090', kind: 'evil' }, keyLines: [] }))).toEqual({ ok: false, reason: 'invalid' });
    expect(await decodeProfile(enc({ name: 'x', keyLines: [] }))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('多余字段丢掉，不会混进配置', async () => {
    const enc = (o: unknown) => 'homenet:1:' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await decodeProfile(enc({ name: 'x', demo: true, allowPublic: true, evil: 1, router: { url: 'http://10.0.0.1', extra: 2 }, keyLines: [] }));
    expect(r).toEqual({ ok: true, encrypted: false, profile: { name: 'x', router: { url: 'http://10.0.0.1' }, keyLines: [] } });
  });
});
