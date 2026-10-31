<script setup lang="ts">
const { stores, activeStore, setActiveStore } = useActiveStore()
const { signOut } = useAuth()

const storeItems = computed(() => stores.value.map(store => ({ label: store.name, value: store.id })))
const selectedStoreId = computed({
  get: () => activeStore.value?.id,
  set: (id) => {
    if (id) setActiveStore(id)
  },
})

const navItems = [
  { label: 'Đơn hàng', to: '/app/orders', icon: 'i-lucide-receipt' },
  { label: 'Cài đặt', to: '/app/settings', icon: 'i-lucide-settings' },
]

async function onSignOut() {
  try {
    await signOut()
  }
  catch {
    // Local session state is already cleared by signOut(); nothing else to recover.
  }
  finally {
    await navigateTo('/login')
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-default">
    <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-default bg-default/95 px-4 py-3 backdrop-blur">
      <div class="min-w-0 flex-1">
        <USelect
          v-if="storeItems.length > 1"
          v-model="selectedStoreId"
          :items="storeItems"
          aria-label="Chọn cửa hàng"
          size="lg"
          class="w-full max-w-60"
        />
        <p v-else data-testid="active-store-name" class="truncate font-semibold">
          {{ activeStore?.name }}
        </p>
        <span v-if="storeItems.length > 1" data-testid="active-store-name" class="sr-only">{{ activeStore?.name }}</span>
      </div>
      <UButton variant="ghost" color="neutral" size="lg" icon="i-lucide-log-out" @click="onSignOut">
        Đăng xuất
      </UButton>
    </header>

    <main class="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">
      <slot />
    </main>

    <nav class="fixed inset-x-0 bottom-0 border-t border-default bg-default pb-[env(safe-area-inset-bottom)]" aria-label="Điều hướng chính">
      <ul class="mx-auto flex max-w-3xl">
        <li v-for="item in navItems" :key="item.to" class="flex-1">
          <ULink
            :to="item.to"
            class="flex min-h-14 flex-col items-center justify-center gap-1 text-xs"
            active-class="text-primary font-semibold"
            inactive-class="text-muted"
          >
            <UIcon :name="item.icon" class="size-5" />
            {{ item.label }}
          </ULink>
        </li>
      </ul>
    </nav>
  </div>
</template>
