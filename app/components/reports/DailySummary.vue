<script setup lang="ts">
import { formatVnd } from '#shared/money'
import type { DailySummary } from '#shared/types/reports'

const props = defineProps<{ summary: DailySummary }>()

const summaryStats = computed(() => {
  const s = props.summary
  if (!s) return []
  return [
    { label: 'Tổng đơn', value: String(s.totalOrders) },
    { label: 'Hoàn tất', value: String(s.completedCount) },
    { label: 'Đã hủy', value: String(s.cancelledCount) },
    { label: 'Giá trị đơn', value: formatVnd(s.grossVnd) },
    { label: 'Đã thu', value: formatVnd(s.collectedVnd) },
    { label: 'Còn chưa thu', value: formatVnd(s.outstandingVnd) },
  ]
})

</script>

<template>
  <div class="flex flex-col gap-3">
    <ul class="grid grid-cols-2 gap-3">
      <li v-for="stat in summaryStats" :key="stat.label">
        <ZCard variant="flat" padding="md">
          <p class="text-sm text-muted">{{ stat.label }}</p>
          <p class="break-words font-mono text-lg font-semibold text-default sm:text-xl">{{ stat.value }}</p>
        </ZCard>
      </li>
    </ul>
    <ZCard variant="flat" padding="md" title="Đã thu theo hình thức">
      <ul class="flex flex-col gap-1 text-sm">
        <li class="flex justify-between"><span class="text-muted">Tiền mặt</span><span class="font-mono">{{ formatVnd(summary.collected.CASH) }}</span></li>
        <li class="flex justify-between"><span class="text-muted">Chuyển khoản (SePay)</span><span class="font-mono">{{ formatVnd(summary.collected.SEPAY) }}</span></li>
        <li class="flex justify-between"><span class="text-muted">Chuyển khoản (xác nhận tay)</span><span class="font-mono">{{ formatVnd(summary.collected.BANK_MANUAL) }}</span></li>
        <li v-if="summary.refundDueVnd > 0" class="flex justify-between text-(--zeno-text)"><span>Cần hoàn tiền</span><span class="font-mono">{{ formatVnd(summary.refundDueVnd) }}</span></li>
      </ul>
    </ZCard>
  </div>
</template>
