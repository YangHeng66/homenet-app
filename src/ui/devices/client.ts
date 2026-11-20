import type { RouterClient } from '../../lib/types';
import type { IconName } from '../../lib/icons';

const PALETTE = ['#6fcbff', '#ffb547', '#c9b6ff', '#d4ff3a', '#4be3a0', '#ff8fa3'];

export function clientColor(c: RouterClient): string {
  let h = 0;
  for (const ch of c.mac) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 型号简称：取最后一个词，但跳过末尾的版本号和闪存容量（“Cudy TR3000 256MB v1” → TR3000） */
export function shortModel(model: string): string {
  const words = model.trim().split(/\s+/);
  while (words.length > 1 && /^(v\d[\w.]*|rev\.?\w*|\d+|\d+(mb|gb))$/i.test(words.at(-1)!)) words.pop();
  if (words.length > 1 && /^rev\.?$/i.test(words.at(-1)!)) words.pop();
  return words.at(-1)!;
}

export const clientIcon =(c: RouterClient): IconName => (c.kind === 'other' ? 'phone' : c.kind);

export function linkText(c: RouterClient): string {
  if (c.link === 'wired') return c.linkSpeedMbps ? `有线 ${c.linkSpeedMbps}M` : '有线';
  const band = c.link === '2g' ? '2.4G' : c.link === '5g' ? '5G' : '6G';
  return c.signal != null ? `${band} · −${Math.abs(c.signal)}dBm` : band;
}

/** 头像缩写：英文名取前两个字母，中文名取第一个字（头像只有 30px） */
export function initials(name: string): string {
  // 没有主机名的设备用 IP 当名字，取最后一段才分得开
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(name) ? name.split('.')[3] : null;
  if (ip) return ip;
  const latin = name.replace(/[^A-Za-z0-9]/g, '');
  if (latin.length >= 2) return latin.slice(0, 2);
  return [...name][0] ?? '?';
}
