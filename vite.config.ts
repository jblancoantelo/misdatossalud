import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

/** Fecha de compilación en formato ordenable: 20261102-213045. */
function buildStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

const BUILD_TIME = buildStamp()

/**
 * Publica `version.json` junto al bundle. No se precachea: la app lo pide a la
 * red para saber si hay una compilación más nueva que la instalada.
 */
function versionFile(): Plugin {
  return {
    name: 'misdatossalud-version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: pkg.version, buildTime: BUILD_TIME }, null, 2),
      })
    },
  }
}

// GitHub Pages sirve el proyecto en /misdatossalud/.
export default defineConfig({
  base: '/misdatossalud/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    VitePWA({
      // El usuario decide cuándo descargar la versión nueva (Ajustes o aviso).
      registerType: 'prompt',
      // El registro lo hace src/pwa/update.ts con `registerSW`.
      injectRegister: null,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'mis datos salud',
        short_name: 'misalud',
        description:
          'Panel local-first para tus datos de Amazfit/Zepp y Health Connect. Sin backend propio.',
        lang: 'es',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0f14',
        theme_color: '#0f766e',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
    versionFile(),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
