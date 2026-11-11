import type { Latency } from './types';

const KB = 1024, MB = KB * 1024, GB = MB * 1024;

/** 速率拆成数值和单位，配合设计稿 <b>数值</b><u>单位</u> 的写法 */
export function rateParts(bps: number): [string, string] {
  if (bps >= MB) return [(bps / MB).toFixed(2), 'MB/s'];
  return [String(Math.round(bps / KB)), 'KB/s'];
}

export const rateText = (bps: number) => {
  if (bps >= MB) return (bps / MB).toFixed(1) + ' MB/s';
  return Math.max(1, Math.round(bps / KB)) + ' KB/s';
};

export const mbs = (bps: number) => (bps / MB).toFixed(1);
export const gb = (b: number, d = 1) => (b / GB).toFixed(d);

export const latClass = (v: Latency) => (v == null ? 'dim' : v < 200 ? 'ok' : v < 320 ? 'warn' : 'bad');
export const latText = (v: Latency) => (v == null ? '超时' : v + 'ms');

export function duration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const hours = (sec: number) => `${Math.floor(sec / 3600)}h`;

const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (t: number) => { const d = new Date(t); return `${d.getHours()}:${pad(d.getMinutes())}`; };

/** “今天 04:00 / 昨 21:12 / 11-02” */
export function when(t: number, todayWord = '今天 '): string {
  const d = new Date(t), n = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff === 0) return todayWord + hm(t);
  if (diff === 1) return '昨 ' + hm(t);
  if (diff === -1) return '明天 ' + hm(t);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return '刚刚';
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return when(t);
}

export const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** 固定点数的折线 path，供 SVG 原地更新 d 属性 */
export function chartPath(arr: number[], w: number, h: number, max: number): string {
  const step = w / (arr.length - 1);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - (arr[i] / max) * (h - 8) - 2).toFixed(1)}`;
  return s;
}
