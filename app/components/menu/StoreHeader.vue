<script setup lang="ts">
import type { PublicModes } from '#shared/types/catalog'

const props = defineProps<{
  name: string
  isAcceptingOrders: boolean
  modes: PublicModes
  tableLabel?: string | null
}>()

const chips = computed(() => {
  const list: { label: string, icon: string }[] = []
  if (props.tableLabel) list.push({ label: props.tableLabel, icon: 'i-lucide-armchair' })
  if (props.modes.pickup) list.push({ label: 'Mang đi', icon: 'i-lucide-shopping-bag' })
  if (props.modes.delivery.available) list.push({ label: 'Giao hàng', icon: 'i-lucide-bike' })
  return list
})
</script>

<template>
  <header class="flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <h1 data-testid="store-name" class="text-h2 min-w-0 break-words text-default">
        {{ name }}
      </h1>
      <ZBadge
        :status="isAcceptingOrders ? 'success' : 'warning'"
        :icon="isAcceptingOrders ? 'i-lucide-circle-dot' : 'i-lucide-pause'"
        class="mt-2 shrink-0"
      >
        {{ isAcceptingOrders ? 'Đang nhận đơn' : 'Tạm nghỉ' }}
      </ZBadge>
    </div>
    <ul v-if="chips.length" class="flex flex-wrap gap-2" aria-label="Hình thức nhận món">
      <li v-for="chip in chips" :key="chip.label">
        <ZBadge status="neutral" size="sm" :icon="chip.icon">
          {{ chip.label }}
        </ZBadge>
      </li>
    </ul>
  </header>
</template>
