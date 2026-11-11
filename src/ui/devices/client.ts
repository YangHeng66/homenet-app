import type { RouterClient } from '../../lib/types';
import type { IconName } from '../../lib/icons';

const PALETTE = ['#6fcbff', '#ffb547', '#c9b6ff', '#d4ff3a', '#4be3a0', '#ff8fa3'];

export function clientColor(c: RouterClient): string {
  let h = 0;
  for (const ch of c.mac) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const clientIcon = (c: RouterClient): IconName => (c.kind === 'other' ? 'phone' : c.kind);

export function linkText(c: RouterClient): string {
  if (c.link === 'wired') return `有线 ${c.linkSpeedMbps ?? ''}M`.trim();
  const band = c.link === '2g' ? '2.4G' : c.link === '5g' ? '5G' : '6G';
  return c.signal != null ? `${band} · −${Math.abs(c.signal)}dBm` : band;
}

/** 头像缩写：英文名取前两个字母，中文名取第一个字（头像只有 30px） */
export function initials(name: string): string {
  const latin = name.replace(/[^A-Za-z0-9]/g, '');
  if (latin.length >= 2) return latin.slice(0, 2);
  return [...name][0] ?? '?';
}
