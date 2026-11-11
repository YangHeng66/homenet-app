/*
 * 按一套配置创建真实连接器。没填的模块为 undefined，界面整块隐藏。
 * 演示模式（profile.demo）由调用方改用 src/lib/mock，这里不处理。
 */
import type { Connectors, Profile } from '../types';
import { createHttp, type Http } from './http';
import { createMihomo, type MihomoOptions } from './mihomo';
import { createOpenWrt, type OpenWrtOptions } from './openwrt';
import { createUfi, type UfiOptions } from './ufi';

export interface ConnectorOptions {
  http?: Http;
  /** 用户确认过“允许公网地址”（明文 HTTP，密码会被看到）时为 true */
  allowPublic?: boolean;
  mihomo?: MihomoOptions;
  openwrt?: OpenWrtOptions;
  ufi?: UfiOptions;
}

export function createConnectors(profile: Profile, opts: ConnectorOptions = {}): Connectors {
  const http = opts.http ?? createHttp({ allowPublic: opts.allowPublic });
  return {
    profile,
    router: profile.router && createOpenWrt(profile.router, http, opts.openwrt),
    mihomo: profile.mihomo && createMihomo(profile.mihomo, http, opts.mihomo),
    ufi: profile.ufi && createUfi(profile.ufi, http, opts.ufi),
  };
}

export { addressScope, createHttp } from './http';
export { createMihomo } from './mihomo';
export { createOpenWrt } from './openwrt';
export { createUfi } from './ufi';
