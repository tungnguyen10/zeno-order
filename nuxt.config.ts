import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-14',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@pinia/nuxt', '@nuxtjs/supabase'],
  runtimeConfig: {
    supabase: {
      secretKey: '',
    },
    turnstile: {
      secretKey: '',
    },
    order: {
      rateLimitMax: 8,
      rateLimitWindowSeconds: 60,
    },
    tracking: {
      keyVersion: 1,
      secretsJson: '',
    },
    public: {
      appUrl: 'http://127.0.0.1:3000',
      turnstileSiteKey: '',
    },
  },
  supabase: {
    url: process.env.NUXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    key: process.env.NUXT_PUBLIC_SUPABASE_KEY ?? 'local-publishable-key',
    redirect: false,
    types: false,
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
