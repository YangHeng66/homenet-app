/* 设置向导的表单状态和它与 Profile 之间的转换 */
import type { KeyLine, MihomoKind, Profile } from './types';
import type { SharedProfile } from './share';
import { addressScope } from './connectors/http';
import { normalizeUrl, parseDomains } from './validate';

export interface WizardForm {
  name: string;
  router: { on: boolean; url: string; username: string; password: string };
  mihomo: { on: boolean; url: string; secret: string; kind: MihomoKind };
  ufi: { on: boolean; url: string; password: string };
  keyLine: { on: boolean; group: string; name: string; expectIp: string; checkUrl: string; domains: string };
  /** 第一条之后的重点线路，向导不编辑，原样保留 */
  restKeyLines: KeyLine[];
  keyLineId?: string;
  allowPublic: boolean;
}

export const DEFAULT_PORT = { router: undefined, mihomo: 9090, ufi: 2333 } as const;

export function formFrom(p?: Profile | SharedProfile): WizardForm {
  const k = p?.keyLines[0];
  return {
    name: p?.name ?? '',
    router: { on: !p || !!p.router, url: p?.router?.url ?? '', username: p?.router?.username ?? 'root', password: p?.router?.secret ?? '' },
    mihomo: { on: !!p?.mihomo, url: p?.mihomo?.url ?? '', secret: p?.mihomo?.secret ?? '', kind: p?.mihomo?.kind ?? 'mihomo' },
    ufi: { on: !!p?.ufi, url: p?.ufi?.url ?? '', password: p?.ufi?.secret ?? '' },
    keyLine: { on: !!k, group: k?.group ?? '', name: k?.name ?? '', expectIp: k?.expectIp ?? '', checkUrl: k?.checkUrl ?? '', domains: k?.domains.join(', ') ?? '' },
    restKeyLines: p?.keyLines.slice(1) ?? [],
    keyLineId: k?.id,
    allowPublic: !!(p && 'allowPublic' in p && p.allowPublic),
  };
}

function url(raw: string, port: number | undefined, label: string): string {
  const u = normalizeUrl(raw, port);
  if (!u) throw new Error(`${label}地址不对：${raw || '没填'}`);
  return u;
}

export const hasModule = (f: WizardForm) => (f.router.on && !!f.router.url.trim()) || (f.mihomo.on && !!f.mihomo.url.trim()) || (f.ufi.on && !!f.ufi.url.trim());

export function buildProfile(f: WizardForm, id: string): Profile {
  const p: Profile = { id, name: f.name.trim() || '我的网络', demo: false, keyLines: [] };
  if (f.router.on && f.router.url.trim()) {
    p.router = { url: url(f.router.url, DEFAULT_PORT.router, '路由器'), username: f.router.username.trim() || 'root' };
    if (f.router.password) p.router.secret = f.router.password;
  }
  if (f.mihomo.on && f.mihomo.url.trim()) {
    p.mihomo = { url: url(f.mihomo.url, DEFAULT_PORT.mihomo, '代理'), kind: f.mihomo.kind };
    if (f.mihomo.secret) p.mihomo.secret = f.mihomo.secret;
  }
  if (f.ufi.on && f.ufi.url.trim()) {
    p.ufi = { url: url(f.ufi.url, DEFAULT_PORT.ufi, 'F50 ') };
    if (f.ufi.password) p.ufi.secret = f.ufi.password;
  }
  if (f.keyLine.on && f.keyLine.group) {
    const k: KeyLine = {
      id: f.keyLineId ?? 'k' + Date.now().toString(36),
      name: f.keyLine.name.trim() || f.keyLine.group,
      group: f.keyLine.group,
      domains: parseDomains(f.keyLine.domains),
    };
    if (f.keyLine.expectIp.trim()) k.expectIp = f.keyLine.expectIp.trim();
    if (f.keyLine.checkUrl.trim()) k.checkUrl = url(f.keyLine.checkUrl, undefined, '核对');
    p.keyLines.push(k);
  }
  p.keyLines.push(...f.restKeyLines);
  p.allowPublic = f.allowPublic;
  return p;
}

/** 开着的模块里哪些地址在公网上（要弹明文 HTTP 警告） */
export function publicUrls(f: WizardForm): string[] {
  const out: string[] = [];
  for (const [m, port] of [['router', DEFAULT_PORT.router], ['mihomo', DEFAULT_PORT.mihomo], ['ufi', DEFAULT_PORT.ufi]] as const) {
    const e = f[m];
    if (!e.on || !e.url.trim()) continue;
    const u = normalizeUrl(e.url, port);
    if (u && addressScope(u) === 'public') out.push(u);
  }
  return out;
}
