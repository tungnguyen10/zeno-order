export default defineNuxtConfig({
  compatibilityDate: '2026-09-14',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
    typeCheck: true,
  },
  fonts: {
    defaults: { subsets: ['vietnamese', 'latin'], styles: ['normal'] },
    families: [
      { name: 'Fraunces', provider: 'google', weights: [500, 600], preload: true },
      { name: 'Work Sans', provider: 'google', weights: [400, 500, 600] },
      { name: 'IBM Plex Mono', provider: 'google', weights: [400, 500] },
    ],
  },
  colorMode: { preference: 'system', fallback: 'light', storageKey: 'zeno-color-mode' },
  icon: { serverBundle: 'local', clientBundle: { scan: true } },
  app: {
    head: {
      htmlAttrs: { lang: 'vi' },
      titleTemplate: '%s — ZENO',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Đặt món tại bàn qua QR cho quán cafe & trà sữa.' },
        { name: 'apple-mobile-web-app-title', content: 'ZENO' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },
  runtimeConfig: {
    public: {
      neonAuthUrl: process.env.NEON_AUTH_BASE_URL ?? '',
      appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    },
  },
  routeRules: {
    '/app/**': { ssr: false },
    '/login': { ssr: false },
    '/signup': { ssr: false },
    '/onboarding': { ssr: false },
    '/invite/**': { ssr: false },
  },
})
