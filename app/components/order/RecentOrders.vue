<script setup lang="ts">
import { formatVnd } from '#shared/money'

const props = defineProps<{ slug: string }>()
const recentOrders = useRecentOrders()
const recent = computed(() => recentOrders.forStore(props.slug).value)
const top = computed(() => recent.value.slice(0, 3))
</script>

<template>
  <nav v-if="top.length > 0" aria-label="Đơn gần đây" class="flex flex-col gap-2">
    <p class="text-sm font-medium text-muted">
      Đơn gần đây của bạn
    </p>
    <ul class="flex flex-col gap-2">
      <li v-for="order in top" :key="order.token">
        <NuxtLink
          :to="`/o/${order.token}`"
          class="flex min-h-11 items-center justify-between gap-3 rounded-md bg-(--zeno-surface) px-4 py-2 ring-1 ring-default"
        >
          <span class="font-mono text-sm text-default">#{{ order.publicCode }}</span>
          <span class="ms-auto font-mono text-sm text-muted">{{ formatVnd(order.totalVnd) }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
