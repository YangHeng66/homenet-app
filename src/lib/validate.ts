/* 界面输入的整理和校验（设置向导、改名） */
import { normalizeHost } from './rules';

/** DHCP 主机名：字母数字和连字符，首尾不能是连字符，最长 63 */
export const isHostname = (v: string) => /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(v);

/** 用户只填 IP 时补上 http:// 和默认端口，去掉结尾的 /；填不成合法地址返回 null */
export function normalizeUrl(raw: string, defaultPort?: number): string | null {
  let t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'http://' + t;
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  if (defaultPort && !u.port) u.port = String(defaultPort);
  return u.toString().replace(/\/$/, '');
}

export function parseDomains(raw: string): string[] {
  return [...new Set(raw.split(/[\s,，]+/).map(normalizeHost).filter(Boolean))];
}
