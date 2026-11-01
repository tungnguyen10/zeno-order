<script setup lang="ts">
import type { PublicMenu } from '#shared/types/catalog'
import { groupByCategory } from '#shared/menu-groups'
import { formatVnd } from '#shared/money'

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? '').toLowerCase())

const { data: menu, error, refresh } = await useFetch<PublicMenu>(
  () => `/api/public/stores/${encodeURIComponent(slug.value)}/menu`,
)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })
}

useSeoMeta({
  title: () => menu.value?.store.name ?? 'Thực đơn',
  description: () => `Xem thực đơn và đặt món tại ${menu.value?.store.name ?? 'quán'}.`,
})

const sections = computed(() => (menu.value ? groupByCategory(menu.value.categories, menu.value.products) : []))
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 pb-16 pt-[calc(1.25rem+env(safe-area-inset-top))]">
    <ZAlert v-if="error" color="error" title="Không tải được menu">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else-if="menu">
      <MenuStoreHeader :name="menu.store.name" :is-accepting-orders="menu.store.isAcceptingOrders" :modes="menu.modes" />

      <ZAlert
        v-if="!menu.store.isAcceptingOrders"
        color="warning"
        title="Quán đang tạm nghỉ"
        description="Bạn vẫn xem được menu, nhưng chưa đặt món được lúc này."
      />

      <AppEmptyState
        v-if="sections.length === 0"
        icon="i-lucide-coffee"
        title="Menu đang được cập nhật"
        description="Quán đang thêm món. Bạn quay lại sau ít phút nhé."
      />

      <section v-for="section in sections" :key="section.id ?? 'other'" class="flex flex-col gap-3">
        <h2 class="text-h3 text-default">
          {{ section.name }}
        </h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="product in section.products"
            :key="product.id"
            class="flex items-center justify-between gap-3 rounded-md bg-(--zeno-surface) p-4 ring-1 ring-default"
          >
            <div class="min-w-0">
              <p class="break-words font-medium text-default">
                {{ product.name }}
              </p>
              <p class="font-mono text-sm text-muted">
                {{ formatVnd(product.basePriceVnd) }}
              </p>
            </div>
            <ZBadge v-if="!product.isAvailable" status="neutral" size="sm">
              Hết hàng
            </ZBadge>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
