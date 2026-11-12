import { describe, expect, it } from 'vitest';
import { planReach } from './reach';
import type { MihomoConnection, ProxySnapshot, Rule } from './types';

const snap: ProxySnapshot = {
  groups: [
    { name: 'Main Proxy', type: 'Selector', now: 'Node-A', all: ['Node-A'], testUrl: 'https://cp.example.com/generate_204' },
    { name: 'Claude', type: 'Selector', now: 'Node-B', all: ['Node-B'] },
  ],
  nodes: {},
};
const rules: Rule[] = [
  { type: 'DOMAIN-SUFFIX', payload: 'claude.ai', proxy: 'Claude' },
  { type: 'RULE-SET', payload: 'some-unknown-set', proxy: 'DIRECT' },
  { type: 'MATCH', payload: '', proxy: 'Main Proxy' },
];
const conn = (host: string, chains: string[]): MihomoConnection => ({
  id: host, host, destination: '', network: 'tcp', sourceIp: '192.168.1.20', chains, rule: 'RuleSet', rulePayload: 'x',
  upload: 0, download: 0, rate: { up: 0, down: 0 }, start: 0,
});

describe('planReach：连通性卡片每个站点走哪个分组、怎么测', () => {
  it('有这个网站的实时连接时，以连接实际走的分组为准', () => {
    const p = planReach('www.bilibili.com', rules, [], snap, [conn('api.bilibili.com', ['DIRECT'])]);
    expect(p).toMatchObject({ target: 'DIRECT', live: true, guessed: false });
  });

  it('实时连接的分组取链路最外层（规则指向的分组）', () => {
    const p = planReach('www.youtube.com', rules, [], snap, [conn('i.ytimg.com', ['Node-A', 'Main Proxy']), conn('www.youtube.com', ['Node-A', 'Main Proxy'])]);
    expect(p).toMatchObject({ target: 'Main Proxy', live: true });
  });

  it('没有实时连接时按规则推测；跳过了无法判断的规则也标为推测', () => {
    expect(planReach('claude.ai', rules, [], snap, [])).toMatchObject({ target: 'Claude', live: false, guessed: false });
    expect(planReach('www.bilibili.com', rules, [], snap, [])).toMatchObject({ target: 'Main Proxy', live: false, guessed: true });
  });

  it('直连测站点本身；经代理用分组自己的测速地址，没有就交给连接器的默认地址', () => {
    expect(planReach('www.bilibili.com', rules, [], snap, [conn('www.bilibili.com', ['DIRECT'])]).testUrl).toBe('https://www.bilibili.com');
    expect(planReach('www.github.com', rules, [], snap, []).testUrl).toBe('https://cp.example.com/generate_204');
    expect(planReach('claude.ai', rules, [], snap, []).testUrl).toBeUndefined();
  });

  it('不把只是结尾相同的域名当成同一个网站', () => {
    const p = planReach('www.bilibili.com', rules, [], snap, [conn('notbilibili.com', ['DIRECT'])]);
    expect(p.live).toBe(false);
  });
});
