import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-14',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@pinia/nuxt', '@nuxtjs/supabase'],
  runtimeConfig: {
    supabaseServiceRoleKey: '',
    public: {
      appUrl: 'http://127.0.0.1:3000',
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
