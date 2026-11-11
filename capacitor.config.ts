import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.homenet.control',
  appName: 'HomeNet',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'DEFAULT' },
    CapacitorHttp: { enabled: true },
  },
};

export default config;
