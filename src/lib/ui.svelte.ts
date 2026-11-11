/* 全局浮层：确认面板、底部详情面板、回滚倒计时坞、toast */
import type { ImpactLine, Profile, Rollback } from './types';
import type { SharedProfile } from './share';
import type { IconName } from './icons';
import { haptic } from './native';

export interface AskOptions {
  title: string;
  what: string;
  impact: ImpactLine[];
  /** 危险操作：黄黑警示条 + 长按确认 */
  hz?: boolean;
  ok?: string;
  icon?: IconName;
}

export type SheetState = { kind: 'client'; mac: string } | { kind: 'newtask' };

/** 盖住整个 App 的页面：设置向导、配置列表、导出、导入 */
export type Screen =
  | { kind: 'wizard'; base?: Profile; prefill?: SharedProfile }
  | { kind: 'profiles' }
  | { kind: 'export'; profile: Profile }
  | { kind: 'import' };

export interface DockOptions {
  title: string;
  sub: string;
  secs: number;
  /** 显示“保留更改”按钮 */
  keep?: boolean;
  /** 第几秒自动确认（App 检测网络通过） */
  autoOk?: number;
  rollback?: Rollback;
  onKeep?: () => void;
  onRevert?: () => void;
}

interface DockState {
  title: string;
  sub: string;
  secs: number;
  left: number;
  keep: boolean;
  done: null | 'ok' | 'rb';
}

export const ui = $state({
  confirm: null as (AskOptions & { resolve: (ok: boolean) => void }) | null,
  sheet: null as SheetState | null,
  toast: '',
  toastOn: false,
  dock: null as DockState | null,
  screen: null as Screen | null,
});

/** 全屏页面自己处理返回键（比如向导退回上一步），返回 false 表示交给外层关闭页面 */
let screenBack: (() => boolean) | null = null;
export function onScreenBack(fn: (() => boolean) | null) { screenBack = fn; }

/** 页面栈：从配置页打开导出、向导后，返回回到配置页 */
const stack: Screen[] = [];
export function openScreen(sc: Screen) {
  if (ui.screen) stack.push(ui.screen);
  ui.sheet = null;
  ui.screen = sc;
  scrollTo({ top: 0 });
}
export function closeScreen() { screenBack = null; ui.screen = stack.pop() ?? null; }
export function closeAllScreens() { stack.length = 0; screenBack = null; ui.screen = null; }

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  ui.toast = msg;
  ui.toastOn = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toastOn = false), 2200);
}

export function ask(opts: AskOptions): Promise<boolean> {
  ui.confirm?.resolve(false);
  return new Promise(resolve => {
    ui.confirm = { hz: true, ...opts, resolve };
  });
}

export function closeAsk(ok = false) {
  const c = ui.confirm;
  if (!c) return;
  ui.confirm = null;
  c.resolve(ok);
}

export function openSheet(s: SheetState) { ui.sheet = s; }
export function closeSheet() { ui.sheet = null; }

/** 返回键依次关闭：确认面板 → 详情面板 → 全屏页面（先让页面自己退一步） */
export function closeTopLayer(): boolean {
  if (ui.confirm) { closeAsk(false); return true; }
  if (ui.sheet) { closeSheet(); return true; }
  if (screenBack?.()) return true;
  if (ui.screen) { closeScreen(); return true; }
  return false;
}

/* ── 回滚坞：同一时间只允许一个事务 ── */
let dockTimer: ReturnType<typeof setInterval> | undefined;
let dockOpts: DockOptions | null = null;
let deadline = 0;
let started = 0;

export const dockBusy = () => !!ui.dock && !ui.dock.done;

export function dock(opts: DockOptions) {
  clearInterval(dockTimer);
  dockOpts = opts;
  started = Date.now();
  deadline = started + opts.secs * 1000;
  ui.dock = { title: opts.title, sub: opts.sub, secs: opts.secs, left: opts.secs, keep: !!opts.keep, done: null };
  dockTimer = setInterval(dockTick, 1000);
  scrollTo({ top: 0, behavior: 'smooth' });
}

function dockTick() {
  const d = ui.dock;
  if (!d || !dockOpts) return;
  d.left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  const elapsed = Math.round((Date.now() - started) / 1000);
  if (dockOpts.autoOk && elapsed >= dockOpts.autoOk) { dockKeep('网络正常，已生效'); return; }
  if (d.left <= 0) dockRevert('超时未确认，已自动恢复');
}

export function dockKeep(msg = '已保留') {
  const o = dockOpts;
  if (!o || !ui.dock || ui.dock.done) return;
  o.rollback?.confirm();
  o.onKeep?.();
  haptic.success();
  finish('ok', msg);
}

export function dockRevert(msg = '已恢复') {
  const o = dockOpts;
  if (!o || !ui.dock || ui.dock.done) return;
  o.rollback?.revert();
  o.onRevert?.();
  haptic.warn();
  finish('rb', msg);
}

function finish(kind: 'ok' | 'rb', msg: string) {
  clearInterval(dockTimer);
  dockOpts = null;
  const d = ui.dock!;
  d.done = kind;
  d.title = msg;
  d.sub = kind === 'ok' ? '已写入配置' : '已恢复原来的设置';
  setTimeout(() => { if (ui.dock?.done) ui.dock = null; }, 2600);
}
