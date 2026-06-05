import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { sveltePhosphorOptimize } from 'phosphor-svelte/vite'

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {}

const suwayomiProxyTarget =
  env.VITE_SUWAYOMI_PROXY_TARGET ??
  env.MOKU_SUWAYOMI_SERVER_URL ??
  'http://127.0.0.1:4567'

export default defineConfig({
  plugins: [sveltekit(), sveltePhosphorOptimize()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(env.npm_package_version ?? '0.0.0'),
  },
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/suwayomi': {
        target: suwayomiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/suwayomi/, ''),
      },
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !env.TAURI_DEBUG ? 'oxc' : false,
    sourcemap: !!env.TAURI_DEBUG,
    rollupOptions: {
      external: [
        '@capacitor/filesystem',
        '@capacitor/app',
        '@capacitor/browser',
        'capacitor-native-biometric',
      ],
    },
  },
})
