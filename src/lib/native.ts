/* 原生能力的薄封装；在浏览器里（vite dev）全部降级为空操作或 Web 实现。 */
import { Capacitor, SystemBars, SystemBarsStyle, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const isNative = Capacitor.isNativePlatform();

export function setSystemBars(dark: boolean) {
  if (!isNative) return;
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

/** 返回键：handler 返回 true 表示已处理，否则走“再按一次退出” */
export function onBackButton(handler: () => boolean, onExitHint: () => void) {
  if (!isNative) return;
  let last = 0;
  App.addListener('backButton', () => {
    if (handler()) return;
    const t = Date.now();
    if (t - last < 2000) App.exitApp();
    else { last = t; onExitHint(); }
  });
}

export function onAppActive(cb: (active: boolean) => void) {
  document.addEventListener('visibilitychange', () => cb(!document.hidden));
  if (isNative) App.addListener('appStateChange', s => cb(s.isActive));
}

export const haptic = {
  tick() { if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); },
  success() { if (isNative) Haptics.notification({ type: NotificationType.Success }).catch(() => {}); },
  warn() { if (isNative) Haptics.notification({ type: NotificationType.Warning }).catch(() => {}); },
};

interface FontScalePlugin {
  get(): Promise<{ scale: number }>;
}
const FontScale = registerPlugin<FontScalePlugin>('FontScale');

/*
 * 系统字体放大：原生端已把 WebView 的 textZoom 固定为 100，避免只放大文字撑破磁贴；
 * 这里把系统倍率限制在 0.85–1.3（窄屏再收紧）后用 CSS zoom 整体等比缩放。
 */
export async function applyFontScale() {
  if (!isNative) return;
  try {
    const { scale } = await FontScale.get();
    // 放大后等效宽度不低于 340dp，窄屏手机上不让磁贴里的数字折行
    const cap = Math.max(1, Math.min(screen.width, screen.height) / 340);
    const z = Math.min(1.3, cap, Math.max(0.85, scale || 1));
    document.documentElement.style.setProperty('--z', String(z));
  } catch { /* 没有原生插件时保持 1 */ }
}
