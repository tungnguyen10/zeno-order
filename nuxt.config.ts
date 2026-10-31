import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-14',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@pinia/nuxt', '@nuxtjs/supabase'],
  typescript: {
    strict: true,
    typeCheck: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
