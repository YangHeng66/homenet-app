/* 配置相关的用户操作：切换、编辑、删除、进演示 */
import type { Profile } from './types';
import { conn, profiles, store, switchProfile, deactivate } from './store.svelte';
import { ask, closeAllScreens, dockBusy, openScreen, toast } from './ui.svelte';
import { DEMO_PROFILE } from './mock';

export const modulesText = (p: Profile) =>
  p.demo ? '演示数据，不连任何设备' : [p.router && '路由器', p.mihomo && p.mihomo.kind, p.ufi && 'F50'].filter(Boolean).join(' · ') || '没有模块';

export async function useProfile(id: string) {
  if (dockBusy()) { toast('还有一项更改在等待确认，确认或恢复后再切换'); return; }
  if (id === profiles.currentId() && store.view === 'app') { closeAllScreens(); return; }
  try {
    await switchProfile(id);
    closeAllScreens();
    toast(`已切换到「${conn.profile.name}」`);
  } catch (e) {
    toast(`切换失败：${e instanceof Error ? e.message : e}`);
  }
}

export const enterDemo = () => useProfile(DEMO_PROFILE.id);

export async function editCurrentProfile() {
  if (conn.profile.demo) { openScreen({ kind: 'wizard' }); return; }
  try { openScreen({ kind: 'wizard', base: await profiles.load(conn.profile.id) }); } catch { openScreen({ kind: 'wizard' }); }
}

export async function editProfile(id: string) {
  openScreen({ kind: 'wizard', base: await profiles.load(id) });
}

export async function exportProfile(id: string) {
  openScreen({ kind: 'export', profile: await profiles.load(id) });
}

export async function deleteProfile(id: string): Promise<boolean> {
  const p = profiles.list().find(x => x.id === id);
  if (!p || p.demo) return false;
  const current = profiles.currentId() === id;
  const ok = await ask({
    title: `删除配置「${p.name}」`, what: modulesText(p), hz: false, ok: '删除', icon: 'x',
    impact: [['i', '这台手机上保存的地址和密码一起删除'], ['i', '路由器、代理、F50 上的设置都不受影响'], ...(current ? [['w', '这是正在用的配置，删除后回到欢迎页'] as ['w', string]] : [])],
  });
  if (!ok) return false;
  await profiles.remove(id);
  toast(`已删除「${p.name}」`);
  if (current) { closeAllScreens(); deactivate(); }
  return true;
}

/** 保存向导填好的配置并切过去 */
export async function saveAndUse(p: Profile) {
  await profiles.save(p);
  await switchProfile(p.id);
  closeAllScreens();
  toast(profiles.secretsPersistent ? `「${p.name}」已保存，密码存在系统 Keystore 里` : `「${p.name}」已保存；当前环境密码只在内存里，重启后要重新填写`);
}
