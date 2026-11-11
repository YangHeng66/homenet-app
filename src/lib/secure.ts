/*
 * 密码和 secret 的存储：安卓上走 capacitor-secure-storage-plugin（Keystore 里的 RSA 密钥加密后存 SharedPreferences，
 * 单个值上限约 245 字节）；浏览器 dev 下只放内存，不用插件自带的明文 localStorage 退路。
 */
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { isNative } from './native';
import { memorySecrets, type SecretStore } from './profiles';

function keystoreSecrets(): SecretStore {
  return {
    persistent: true,
    async get(key) {
      try { return (await SecureStoragePlugin.get({ key })).value; } catch { return null; }
    },
    async set(key, value) { await SecureStoragePlugin.set({ key, value }); },
    async remove(key) { await SecureStoragePlugin.remove({ key }).catch(() => {}); },
  };
}

export function createSecretStore(): SecretStore {
  return isNative ? keystoreSecrets() : memorySecrets();
}
