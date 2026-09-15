<script setup lang="ts">
const client = useSupabaseClient()
const user = useSupabaseUser()
const email = ref('')
const password = ref('')
const pending = ref(false)
const errorMessage = ref('')

if (user.value) await navigateTo('/admin/orders')

async function login() {
  pending.value = true
  errorMessage.value = ''
  const { error } = await client.auth.signInWithPassword({ email: email.value, password: password.value })
  pending.value = false
  if (error) {
    errorMessage.value = 'Email hoặc mật khẩu không đúng.'
    return
  }
  await navigateTo('/admin/orders')
}

useSeoMeta({ title: 'Đăng nhập | Zeno Merchant', robots: 'noindex, nofollow' })
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-slate-950 px-4 text-slate-100">
    <form class="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl" @submit.prevent="login">
      <p class="text-sm font-black uppercase tracking-[0.2em] text-cyan-300">Zeno Merchant</p>
      <h1 class="mt-2 text-3xl font-black">Đăng nhập vận hành</h1>
      <p class="mt-2 text-sm text-slate-400">Dùng tài khoản nhân sự đã được gán vào cửa hàng.</p>
      <p v-if="errorMessage" role="alert" class="mt-4 rounded-xl bg-red-950 p-3 text-sm font-bold text-red-200">{{ errorMessage }}</p>
      <label class="mt-6 block text-sm font-bold">Email
        <input v-model="email" required type="email" autocomplete="email" class="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-slate-950 px-4 outline-none focus:border-cyan-400">
      </label>
      <label class="mt-4 block text-sm font-bold">Mật khẩu
        <input v-model="password" required minlength="8" type="password" autocomplete="current-password" class="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-slate-950 px-4 outline-none focus:border-cyan-400">
      </label>
      <button :disabled="pending" type="submit" class="mt-6 min-h-12 w-full rounded-xl bg-cyan-400 font-black text-slate-950 disabled:opacity-50">
        {{ pending ? 'Đang đăng nhập…' : 'Đăng nhập' }}
      </button>
    </form>
  </main>
</template>
