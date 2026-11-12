/*
 * “这个网址走哪里”：在 App 里按顺序匹配 mihomo 规则。
 * 能确定的类型：DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD / DOMAIN-REGEX / MATCH。
 * GEOSITE 和 RULE-SET 的内容不在控制接口里，只能按分类名推测；推测命中或跳过的规则会标出来，
 * 让界面提示“装插件后可实测”。
 */
import type { MyRule, ProxySnapshot, Rule } from './types';

export interface ProbeResult {
  domain: string;
  /** 命中的规则文本，例如 DOMAIN-SUFFIX,claude.ai */
  rule: string;
  /** 规则指向的分组或 DIRECT/REJECT */
  target: string;
  /** 从目标分组一路解析到节点：["YouTube", "节点选择", "家宽 B", "HomeB-08"] */
  path: string[];
  fromMyRules: boolean;
  /** 按分类名推测命中 */
  guessed: boolean;
  /** 在命中之前跳过了无法判断的规则 */
  skipped: number;
}

/** GEOSITE 常见分类的代表性域名后缀，只用于推测 */
const GEO: Record<string, string[]> = {
  cn: ['cn', 'bilibili.com', 'bilivideo.com', 'baidu.com', 'qq.com', 'taobao.com', 'tmall.com', 'jd.com', 'xiaohongshu.com', 'iqiyi.com', 'weibo.com', 'zhihu.com', 'douyin.com', 'mi.com', '163.com', 'alipay.com'],
  google: ['google.com', 'googleapis.com', 'gstatic.com', 'gmail.com', 'google.cn'],
  youtube: ['youtube.com', 'googlevideo.com', 'ytimg.com', 'youtu.be'],
  github: ['github.com', 'githubusercontent.com', 'github.io', 'githubassets.com'],
  microsoft: ['microsoft.com', 'live.com', 'office.com', 'bing.com', 'github.com'],
  openai: ['openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com'],
  anthropic: ['anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com'],
  telegram: ['telegram.org', 't.me', 'telegram.me'],
  netflix: ['netflix.com', 'nflxvideo.net', 'nflximg.net'],
  apple: ['apple.com', 'icloud.com', 'mzstatic.com'],
};

export function normalizeHost(raw: string): string {
  const authority = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#\s]/)[0];
  return authority.slice(authority.lastIndexOf('@') + 1).split(':')[0].replace(/\.$/, '');
}

const suffixOf = (d: string, s: string) => d === s || d.endsWith('.' + s);

const FOREIGN = [
  ...GEO.google, ...GEO.youtube, ...GEO.github, ...GEO.openai, ...GEO.anthropic, ...GEO.telegram, ...GEO.netflix,
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'whatsapp.com', 'wikipedia.org', 'reddit.com', 'discord.com',
];
const ALIAS: Record<string, string[]> = {
  claude: GEO.anthropic,
  chatgpt: GEO.openai,
  bilibili: ['bilibili.com', 'bilivideo.com', 'biliapi.net', 'hdslb.com'],
};

/**
 * 规则集 / GEOSITE 的名字 → 代表性域名。真实配置里名字五花八门（direct、ChinaMax、geolocation-!cn、国内…），
 * 先判断“非国内”，再判断“国内”，最后按服务名找。认不出返回 null。
 */
function categoryList(raw: string): string[] | null {
  const n = raw.toLowerCase().replace(/^(geolocation|geosite|category)[-_]/, '').replace(/[-_](domains?|sites?|list|rules?)$/, '');
  if (GEO[n]) return GEO[n];
  if (ALIAS[n]) return ALIAS[n];
  if (/!cn|not[-_]?cn|non[-_]?cn|gfw|proxy|global|foreign|overseas|国外|海外|代理/.test(n)) return FOREIGN;
  if (/^(china|chinamax|chinadomain|chinamedia|direct|domestic)$|国内|直连|中国/.test(n)) return GEO.cn;
  const k = Object.keys({ ...GEO, ...ALIAS }).find(k => n.startsWith(k));
  return k ? (GEO[k] ?? ALIAS[k]) : null;
}

function geoGuess(name: string, d: string): boolean | null {
  const list = categoryList(name);
  if (!list) return null;
  return list.some(s => suffixOf(d, s));
}

/** 从分组一路跟 now 走到具体节点 */
export function resolvePath(target: string, snap: ProxySnapshot): string[] {
  const path = [target];
  const seen = new Set(path);
  let g = snap.groups.find(x => x.name === target);
  while (g && !seen.has(g.now)) {
    path.push(g.now);
    seen.add(g.now);
    g = snap.groups.find(x => x.name === g!.now);
  }
  return path;
}

export function probe(raw: string, rules: Rule[], myRules: MyRule[], snap: ProxySnapshot): ProbeResult | null {
  const d = normalizeHost(raw);
  if (!d) return null;

  const mine = myRules.find(r => suffixOf(d, r.domain));
  if (mine) {
    return { domain: d, rule: `DOMAIN-SUFFIX,${mine.domain}（我的规则）`, target: mine.target, path: resolvePath(mine.target, snap), fromMyRules: true, guessed: false, skipped: 0 };
  }

  let skipped = 0;
  for (const r of rules) {
    const p = r.payload.toLowerCase();
    let hit: boolean | null;
    let guessed = false;
    switch (r.type) {
      case 'DOMAIN': hit = d === p; break;
      case 'DOMAIN-SUFFIX': hit = suffixOf(d, p); break;
      case 'DOMAIN-KEYWORD': hit = d.includes(p); break;
      case 'DOMAIN-REGEX': try { hit = new RegExp(r.payload).test(d); } catch { hit = null; } break;
      case 'GEOSITE':
      case 'RULE-SET':
        hit = geoGuess(p, d);
        guessed = hit === true;
        break;
      // 读不到 IP 库：国内常见域名多半解析到国内 IP，按推测命中；其他国家和 private 一律不命中
      case 'GEOIP': hit = p === 'cn' && GEO.cn.some(s => suffixOf(d, s)); guessed = hit; break;
      case 'MATCH': hit = true; break;
      default: hit = /^(GEOIP|IP-|SRC-|DST-|PROCESS|IN-|NETWORK|UID|SUB-RULE|AND|OR|NOT)/.test(r.type) ? false : null;
    }
    if (hit === null) { skipped++; continue; }
    if (hit) {
      const rule = r.type === 'MATCH' ? 'MATCH（前面的规则都没命中）' : `${r.type},${r.payload}`;
      return { domain: d, rule, target: r.proxy, path: resolvePath(r.proxy, snap), fromMyRules: false, guessed, skipped };
    }
  }
  return { domain: d, rule: '没有命中任何规则', target: 'DIRECT', path: ['DIRECT'], fromMyRules: false, guessed: false, skipped };
}
