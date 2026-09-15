<script setup lang="ts">
const client = useSupabaseClient()
const user = useSupabaseUser()

async function signOut() {
  await client.auth.signOut()
  await navigateTo('/admin/login')
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header class="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 backdrop-blur">
      <div class="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <NuxtLink to="/admin/orders" class="text-lg font-black tracking-tight">
          Zeno Merchant
        </NuxtLink>
        <nav aria-label="Vận hành cửa hàng" class="flex items-center gap-4 text-sm font-bold">
          <NuxtLink to="/admin/orders" class="text-cyan-300">Đơn hàng</NuxtLink>
          <span class="hidden text-slate-400 sm:inline">{{ user?.email }}</span>
          <button type="button" class="min-h-10 rounded-xl border border-white/15 px-3" @click="signOut">
            Đăng xuất
          </button>
        </nav>
      </div>
    </header>
    <slot />
  </div>
</template>
