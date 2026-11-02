<script setup lang="ts">
import { formatVnd } from '#shared/money'
import type { Report } from '#shared/types/reports'

const props = defineProps<{ report: Report }>()

const reportStats = computed(() => {
  const r = props.report
  if (!r) return []
  return [
    { label: 'Giá trị đơn', value: formatVnd(r.grossVnd) },
    { label: 'Đã thu', value: formatVnd(r.collectedVnd) },
    { label: 'Số đơn', value: String(r.orderCount) },
    { label: 'Trung bình/đơn', value: formatVnd(r.averageOrderVnd) },
  ]
})

const maxGross = computed(() => Math.max(1, ...(props.report?.daily.map(day => day.grossVnd) ?? [1])))
const shortDate = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`
</script>

<template>
  <div class="flex flex-col gap-3">
    <ul class="grid grid-cols-2 gap-3">
      <li v-for="stat in reportStats" :key="stat.label">
        <ZCard variant="flat" padding="md">
          <p class="text-sm text-muted">{{ stat.label }}</p>
          <p class="break-words font-mono text-lg font-semibold text-default sm:text-xl">{{ stat.value }}</p>
        </ZCard>
      </li>
    </ul>

    <ZCard v-if="report.daily.length > 1" variant="flat" padding="md" title="Giá trị đơn theo ngày">
      <div class="flex h-32 items-end gap-1" role="img" :aria-label="`Biểu đồ giá trị đơn ${report.daily.length} ngày`">
        <div
          v-for="day in report.daily"
          :key="day.date"
          class="min-w-1 flex-1 rounded-t-sm bg-primary/70"
          :style="{ height: `${Math.max(2, Math.round((day.grossVnd / maxGross) * 100))}%` }"
          :title="`${shortDate(day.date)}: ${formatVnd(day.grossVnd)}`"
        />
      </div>
      <p class="mt-2 flex justify-between text-[13px] text-muted">
        <span>{{ shortDate(report.fromDate) }}</span><span>{{ shortDate(report.toDate) }}</span>
      </p>
    </ZCard>

    <ZCard variant="flat" padding="md" title="Món bán chạy">
      <ol v-if="report.topProducts.length" class="flex flex-col gap-2">
        <li v-for="(product, index) in report.topProducts" :key="product.name" class="flex items-baseline justify-between gap-3">
          <span class="min-w-0 truncate"><span class="font-mono text-muted">{{ index + 1 }}.</span> {{ product.name }}</span>
          <span class="shrink-0 text-sm text-muted">{{ product.qty }} món · <span class="font-mono">{{ formatVnd(product.revenueVnd) }}</span></span>
        </li>
      </ol>
      <p v-else class="text-sm text-muted">Chưa có đơn nào trong khoảng này.</p>
    </ZCard>
  </div>
</template>
