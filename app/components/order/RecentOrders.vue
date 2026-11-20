<script setup lang="ts">
import { formatVnd } from '#shared/money'
import type { PublicProduct } from '#shared/types/catalog'
import { planReorder } from '~/utils/reorder'
import type { RecentOrder } from '~/utils/recent-orders'

const props = defineProps<{ slug: string, products?: PublicProduct[], canOrder?: boolean }>()
const emit = defineEmits<{ reordered: [] }>()

const recentOrders = useRecentOrders()
const cart = useCart(() => props.slug)
const toast = useToast()

const recent = computed(() => recentOrders.forStore(props.slug).value)
const top = computed(() => recent.value.slice(0, 3))
const canReorder = computed(() => (props.canOrder ?? true) && (props.products?.length ?? 0) > 0)

function reorder(order: RecentOrder) {
  const plan = planReorder(order.items, props.products ?? [])
  for (const line of plan.lines) cart.add(line)
  if (plan.added === 0) {
    toast.add({ color: 'warning', title: 'Các món không còn phục vụ', description: 'Đơn này không có món nào còn bán lúc này.' })
    return
  }
  toast.add({
    color: 'success',
    title: `Đã thêm ${plan.added} món vào giỏ`,
    description: plan.skipped > 0 ? `${plan.skipped} món không còn bán đã được bỏ qua.` : undefined,
  })
  emit('reordered')
}
</script>

<template>
  <nav v-if="top.length > 0" aria-label="Đơn gần đây" class="flex flex-col gap-2">
    <p class="text-sm font-medium text-muted">
      Đơn gần đây của bạn
    </p>
    <ul class="flex flex-col gap-2">
      <li v-for="order in top" :key="order.token" class="flex items-center gap-2">
        <NuxtLink
          :to="`/o/${order.token}`"
          class="flex min-h-11 flex-1 items-center justify-between gap-3 rounded-md bg-(--zeno-surface) px-4 py-2 ring-1 ring-default"
        >
          <span class="font-mono text-sm text-default">#{{ order.publicCode }}</span>
          <span class="ms-auto font-mono text-sm text-muted">{{ formatVnd(order.totalVnd) }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
        </NuxtLink>
        <ZButton
          v-if="canReorder && order.items.length > 0"
          variant="secondary"
          size="sm"
          icon="i-lucide-rotate-ccw"
          :aria-label="`Đặt lại đơn ${order.publicCode}`"
          @click="reorder(order)"
        >
          Đặt lại
        </ZButton>
      </li>
    </ul>
  </nav>
</template>
