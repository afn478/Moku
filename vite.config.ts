import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { sveltePhosphorOptimize } from 'phosphor-svelte/vite'

export default defineConfig({
  plugins: [sveltekit(), sveltePhosphorOptimize()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'oxc' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
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
