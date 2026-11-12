/* 首页“连通性”：每个站点实际走哪个分组、用什么地址测延迟 */
import type { MihomoConnection, MyRule, ProxySnapshot, Rule } from './types';
import { probe } from './rules';

export interface ReachPlan {
  /** 规则指向的分组，或 DIRECT */
  target: string;
  /** 来自 mihomo 的实时连接（真实走向），不是按规则推测的 */
  live: boolean;
  /** 按分类名推测命中，或跳过了无法判断的规则 */
  guessed: boolean;
  /** 交给 testNode 的地址；undefined = 连接器默认的 generate_204 */
  testUrl?: string;
}

const sameSite = (host: string, site: string) => {
  const root = site.replace(/^www\./, '');
  return host === site || host === root || host.endsWith('.' + root);
};

export function planReach(site: string, rules: Rule[], myRules: MyRule[], snap: ProxySnapshot, conns: MihomoConnection[] = []): ReachPlan {
  const c = conns.find(x => x.chains.length && sameSite(x.host, site));
  let target: string, live: boolean, guessed: boolean;
  if (c) {
    target = c.chains.at(-1)!;
    live = true;
    guessed = false;
  } else {
    const r = probe(site, rules, myRules, snap);
    target = r?.target ?? 'DIRECT';
    live = false;
    guessed = !!r && (r.guessed || r.skipped > 0);
  }
  // 和 Clash 面板一致测“线路延迟”：经代理用分组的测速地址；直连没有测速地址，测站点本身
  const testUrl = target === 'DIRECT' ? `https://${site}` : snap.groups.find(g => g.name === target)?.testUrl;
  return { target, live, guessed, testUrl };
}
