export default defineNuxtConfig({
  compatibilityDate: '2026-09-14',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
    typeCheck: true,
  },
  app: {
    head: {
      htmlAttrs: { lang: 'vi' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
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
