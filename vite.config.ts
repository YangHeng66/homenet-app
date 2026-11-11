import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  build: {
    target: 'chrome100',
    cssMinify: true,
    assetsInlineLimit: 0,
    reportCompressedSize: true,
  },
});
