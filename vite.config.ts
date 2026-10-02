import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    // Order matters: @shared must be matched before the broader @ alias.
    alias: [
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: '@', replacement: resolve(__dirname, 'src/client') },
    ],
  },
  plugins: [
    VitePWA({
      // Prompt mode: a new SW stays waiting until the user clicks "update" in the
      // banner (see features/update/UpdateBanner.ts). autoUpdate would silently
      // skipWaiting + auto-reload, which raced the banner and made updates
      // inconsistent.
      registerType: 'prompt',
      // We register the SW ourselves from the app bundle via `virtual:pwa-register`
      // (bundled JS = script-src 'self', CSP-safe) so we can wire onNeedRefresh.
      injectRegister: null,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Stellplatz Finder',
        short_name: 'Stellplatz',
        description: 'Parkplätze, Camper-Stellplätze und Campingplätze auf der Karte finden',
        lang: 'de',
        theme_color: '#4B5640',
        background_color: '#F4F1EA',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        // clientsClaim makes the activated SW immediately take control of all
        // clients. Combined with the controllerchange listener in the update
        // handler this prevents race conditions where the page reloads before
        // activation (incl. cleanupOutdatedCaches) has finished.
        // IMPORTANT: do NOT add map-tile hosts here. A runtime-caching route makes the
        // SW fetch tiles itself, which is then subject to the SW's CSP `connect-src`
        // (not `img-src`) and gets blocked → grey map. Tiles must stay plain <img>
        // loads (governed by img-src), exactly as without a SW.
        // API calls go cross-origin to Supabase Edge Functions — no SW caching needed.
      },
      devOptions: { enabled: false }, // SW only in production builds
    }),
  ],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Dev: proxy API calls to Supabase Edge Functions.
      // Falls VITE_API_BASE gesetzt ist → direkt zur Production-URL,
      // sonst zu lokalen Supabase Edge Functions (braucht Docker + supabase start).
      '/api': {
        target: process.env['VITE_API_BASE'] || 'http://localhost:54321/functions/v1',
        changeOrigin: !process.env['VITE_API_BASE'],
      },
    },
  },
  test: {
    root: resolve(__dirname, '.'),
    environment: 'jsdom',
    // src/** are the frontend unit tests; supabase/** picks up pure (Deno-free)
    // backend logic such as the Overpass endpoint ranking heuristic; scripts/** the
    // POI-tile build helpers.
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
