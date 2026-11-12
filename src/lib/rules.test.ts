import { describe, expect, it } from 'vitest';
import { normalizeHost, probe, resolvePath } from './rules';
import type { MyRule, ProxySnapshot, Rule } from './types';

const snap: ProxySnapshot = {
  groups: [
    { name: '节点选择', type: 'Selector', now: '家宽', all: ['家宽', 'DIRECT'] },
    { name: '家宽', type: 'Fallback', now: 'Home-01', all: ['Home-01', 'Home-02'] },
    { name: 'YouTube', type: 'Selector', now: '节点选择', all: ['节点选择'] },
    { name: '环 A', type: 'Selector', now: '环 B', all: ['环 B'] },
    { name: '环 B', type: 'Selector', now: '环 A', all: ['环 A'] },
  ],
  nodes: {},
};

const rules: Rule[] = [
  { type: 'DOMAIN', payload: 'exact.example.com', proxy: 'YouTube' },
  { type: 'DOMAIN-SUFFIX', payload: 'claude.ai', proxy: '节点选择' },
  { type: 'DOMAIN-KEYWORD', payload: 'bili', proxy: 'DIRECT' },
  { type: 'DOMAIN-REGEX', payload: '^api\\d+\\.test\\.org$', proxy: '家宽' },
  { type: 'GEOIP', payload: 'CN', proxy: 'DIRECT' },
  { type: 'GEOSITE', payload: 'youtube', proxy: 'YouTube' },
  { type: 'MATCH', payload: '', proxy: '节点选择' },
];

describe('normalizeHost', () => {
  it.each([
    ['  HTTPS://Claude.AI/chat?x=1 ', 'claude.ai'],
    ['example.com:8443', 'example.com'],
    ['example.com.', 'example.com'],
    ['http://a.b.c#frag', 'a.b.c'],
    ['   ', ''],
    ['https://user@example.com', 'example.com'],
    ['https://user:pass@example.com:8443/x', 'example.com'],
    ['user@example.com/path', 'example.com'],
    ['https://example.com/a@b', 'example.com'],
  ])('%j → %j', (raw, host) => {
    expect(normalizeHost(raw)).toBe(host);
  });
});

describe('resolvePath', () => {
  it('沿 now 一路走到节点', () => {
    expect(resolvePath('YouTube', snap)).toEqual(['YouTube', '节点选择', '家宽', 'Home-01']);
  });
  it('不是分组时只有自己', () => {
    expect(resolvePath('DIRECT', snap)).toEqual(['DIRECT']);
  });
  it('分组互相指向时不会死循环', () => {
    expect(resolvePath('环 A', snap)).toEqual(['环 A', '环 B']);
  });
});

describe('probe', () => {
  it('空输入返回 null', () => {
    expect(probe('  ', rules, [], snap)).toBeNull();
  });

  it('DOMAIN 只认完全相同', () => {
    expect(probe('exact.example.com', rules, [], snap)).toMatchObject({ rule: 'DOMAIN,exact.example.com', target: 'YouTube', guessed: false, skipped: 0 });
    expect(probe('sub.exact.example.com', rules, [], snap)?.rule).toBe('MATCH（前面的规则都没命中）');
  });

  it('DOMAIN-SUFFIX 认本身和子域，不认只是结尾相同的域名', () => {
    expect(probe('claude.ai', rules, [], snap)?.rule).toBe('DOMAIN-SUFFIX,claude.ai');
    expect(probe('https://api.claude.ai/v1', rules, [], snap)).toMatchObject({ domain: 'api.claude.ai', target: '节点选择', path: ['节点选择', '家宽', 'Home-01'] });
    expect(probe('notclaude.ai', rules, [], snap)?.rule).toBe('MATCH（前面的规则都没命中）');
  });

  it('DOMAIN-KEYWORD 和 DOMAIN-REGEX', () => {
    expect(probe('www.bilibili.com', rules, [], snap)).toMatchObject({ rule: 'DOMAIN-KEYWORD,bili', target: 'DIRECT', path: ['DIRECT'] });
    expect(probe('api42.test.org', rules, [], snap)?.target).toBe('家宽');
    expect(probe('api.test.org', rules, [], snap)?.rule).toBe('MATCH（前面的规则都没命中）');
  });

  it('GEOSITE 按分类名推测命中时标 guessed', () => {
    expect(probe('rr1.googlevideo.com', rules, [], snap)).toMatchObject({ rule: 'GEOSITE,youtube', target: 'YouTube', guessed: true });
  });

  it('不认识的 GEOSITE / RULE-SET / 写错的正则算跳过，IP 类规则不算', () => {
    const rs: Rule[] = [
      { type: 'GEOSITE', payload: 'some-unknown-category', proxy: 'A' },
      { type: 'RULE-SET', payload: 'streaming', proxy: 'B' },
      { type: 'DOMAIN-REGEX', payload: '(', proxy: 'C' },
      { type: 'IP-CIDR', payload: '10.0.0.0/8', proxy: 'D' },
      { type: 'SRC-IP-CIDR', payload: '192.168.1.2/32', proxy: 'E' },
      { type: 'WHATEVER-NEW', payload: 'x', proxy: 'F' },
      { type: 'MATCH', payload: '', proxy: '节点选择' },
    ];
    expect(probe('example.org', rs, [], snap)).toMatchObject({ target: '节点选择', skipped: 4, guessed: false });
  });

  it('GEOSITE 支持 geolocation- 前缀的分类名', () => {
    const rs: Rule[] = [{ type: 'GEOSITE', payload: 'geolocation-cn', proxy: 'DIRECT' }];
    expect(probe('www.baidu.com', rs, [], snap)).toMatchObject({ target: 'DIRECT', guessed: true });
  });

  it('我的规则优先于 mihomo 规则', () => {
    const mine: MyRule[] = [{ domain: 'claude.ai', target: 'DIRECT', addedAt: 0 }];
    expect(probe('api.claude.ai', rules, mine, snap)).toMatchObject({ target: 'DIRECT', fromMyRules: true, rule: 'DOMAIN-SUFFIX,claude.ai（我的规则）' });
  });

  it('一条都没命中时按直连', () => {
    expect(probe('example.org', rules.slice(0, 3), [], snap)).toMatchObject({ rule: '没有命中任何规则', target: 'DIRECT', path: ['DIRECT'] });
  });
});

describe('probe：真实配置里常见的规则集和 GEOIP', () => {
  const m = (type: string, payload: string, proxy: string): Rule => ({ type, payload, proxy });
  const tail = m('MATCH', '', '节点选择');

  it.each(['direct', 'ChinaMax', 'China', 'cn_domain', 'geosite-cn', '国内', '直连', 'ChinaDomain'])('规则集 %s 按国内分类推测', name => {
    const r = probe('www.bilibili.com', [m('RULE-SET', name, 'DIRECT'), tail], [], snap);
    expect(r).toMatchObject({ target: 'DIRECT', guessed: true, rule: `RULE-SET,${name}` });
  });

  it.each(['proxy', 'gfw', 'Global', 'tld-not-cn'])('规则集 %s 按“国外常见站点”推测', name => {
    expect(probe('www.google.com', [m('RULE-SET', name, '节点选择'), m('MATCH', '', 'DIRECT')], [], snap)).toMatchObject({ target: '节点选择', guessed: true });
    expect(probe('www.bilibili.com', [m('RULE-SET', name, '节点选择'), m('MATCH', '', 'DIRECT')], [], snap)).toMatchObject({ target: 'DIRECT', rule: 'MATCH（前面的规则都没命中）' });
  });

  it('GEOSITE geolocation-!cn 命中国外站点，不命中国内站点', () => {
    const rs = [m('GEOSITE', 'geolocation-!cn', '节点选择'), m('MATCH', '', 'DIRECT')];
    expect(probe('github.com', rs, [], snap)).toMatchObject({ target: '节点选择', guessed: true });
    expect(probe('www.bilibili.com', rs, [], snap)?.target).toBe('DIRECT');
  });

  it('GEOIP,CN 对国内常见域名按推测命中，国外域名不命中', () => {
    const rs = [m('GEOIP', 'CN', 'DIRECT'), tail];
    expect(probe('www.bilibili.com', rs, [], snap)).toMatchObject({ target: 'DIRECT', guessed: true, rule: 'GEOIP,CN' });
    expect(probe('www.google.com', rs, [], snap)).toMatchObject({ target: '节点选择', guessed: false });
  });

  it('GEOIP 的其他国家和 private 不命中、也不算跳过', () => {
    const rs = [m('GEOIP', 'private', 'DIRECT'), m('GEOIP', 'US', 'DIRECT'), tail];
    expect(probe('www.bilibili.com', rs, [], snap)).toMatchObject({ target: '节点选择', skipped: 0 });
  });

  it('专门的服务规则集：youtube、openai、claude、bilibili', () => {
    expect(probe('rr1.googlevideo.com', [m('RULE-SET', 'YouTube', 'YouTube'), tail], [], snap)?.target).toBe('YouTube');
    expect(probe('chatgpt.com', [m('RULE-SET', 'OpenAI', 'DIRECT'), tail], [], snap)?.target).toBe('DIRECT');
    expect(probe('claude.ai', [m('RULE-SET', 'Claude', 'DIRECT'), tail], [], snap)?.target).toBe('DIRECT');
    expect(probe('www.bilibili.com', [m('RULE-SET', 'BiliBili', 'DIRECT'), tail], [], snap)?.target).toBe('DIRECT');
  });
});
