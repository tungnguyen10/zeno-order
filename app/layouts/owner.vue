<script setup lang="ts">
const allNavItems: { label: string, to: string, icon: string, ownerOnly?: boolean }[] = [
  { label: 'Đơn hàng', to: '/app/orders', icon: 'i-lucide-receipt' },
  { label: 'Thực đơn', to: '/app/menu', icon: 'i-lucide-utensils-crossed' },
  { label: 'Báo cáo', to: '/app/reports', icon: 'i-lucide-chart-column' },
  { label: 'Nhân viên', to: '/app/team', icon: 'i-lucide-users', ownerOnly: true },
  { label: 'Đối soát', to: '/app/reconciliation', icon: 'i-lucide-banknote', ownerOnly: true },
  { label: 'Cài đặt', to: '/app/settings', icon: 'i-lucide-settings' },
]
const { activeStore } = useActiveStore()
const navItems = computed(() => allNavItems.filter(item => !item.ownerOnly || activeStore.value?.role === 'OWNER'))
const bottomNavItems = computed(() => navItems.value.filter(item => item.to !== '/app/team'))
const { count: reconciliationCount, refresh: refreshBadge } = useReconciliationBadge()
let badgeTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refreshBadge()
  badgeTimer = setInterval(() => { if (document.visibilityState === 'visible') void refreshBadge() }, 60_000)
})
onBeforeUnmount(() => clearInterval(badgeTimer))
watch(() => activeStore.value?.id, () => { void refreshBadge() })
</script>

<template>
  <div class="min-h-dvh bg-default md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
    <a
      href="#main"
      class="sr-only z-50 rounded-md bg-primary px-4 py-3 font-medium text-(--zeno-on-primary) focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >Bỏ qua tới nội dung</a>

    <aside
      class="sticky top-0 z-20 flex items-center gap-3 border-b border-default bg-default/95 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur md:h-dvh md:flex-col md:items-stretch md:gap-6 md:border-b-0 md:border-r md:bg-(--zeno-surface) md:px-4 md:py-6 md:backdrop-blur-none"
    >
      <div class="hidden md:block">
        <AppLogo to="/app/orders" />
      </div>
      <AppStoreSwitcher class="min-w-0 flex-1 md:flex-none" />
      <nav data-testid="sidebar-nav" aria-label="Điều hướng chính" class="hidden md:block">
        <ul class="flex flex-col gap-1">
          <li v-for="item in navItems" :key="item.to">
            <NuxtLink
              :to="item.to"
              class="flex min-h-11 items-center gap-3 rounded-md border-l-3 border-transparent px-3 font-medium text-muted transition-colors hover:bg-(--zeno-surface-hover) hover:text-default aria-[current=page]:border-primary aria-[current=page]:bg-(--zeno-surface-inset) aria-[current=page]:text-primary"
            >
              <UIcon :name="item.icon" class="size-5" />
              {{ item.label }}
              <span v-if="item.to === '/app/reconciliation' && reconciliationCount > 0" class="rounded-full bg-error px-1.5 text-xs text-white" :aria-label="`${reconciliationCount} mục cần xử lý`">{{ reconciliationCount }}</span>
            </NuxtLink>
          </li>
        </ul>
      </nav>
      <AppAccountMenu class="shrink-0 md:mt-auto" />
    </aside>

    <main id="main" tabindex="-1" class="mx-auto w-full max-w-5xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 outline-none md:px-8 md:pb-12 md:pt-8">
      <slot />
    </main>

    <nav
      data-testid="bottom-nav"
      aria-label="Điều hướng chính"
      class="fixed inset-x-0 bottom-0 z-20 border-t border-default bg-default/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul class="mx-auto flex max-w-lg">
        <li v-for="item in bottomNavItems" :key="item.to" class="flex-1">
          <NuxtLink
            :to="item.to"
            class="group flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted aria-[current=page]:font-semibold aria-[current=page]:text-primary"
          >
            <span class="flex h-8 w-14 items-center justify-center rounded-full transition-colors group-aria-[current=page]:bg-primary/12">
              <UIcon :name="item.icon" class="size-5" />
            </span>
            {{ item.label }}
              <span v-if="item.to === '/app/reconciliation' && reconciliationCount > 0" class="rounded-full bg-error px-1.5 text-xs text-white" :aria-label="`${reconciliationCount} mục cần xử lý`">{{ reconciliationCount }}</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
