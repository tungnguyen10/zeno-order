<script setup lang="ts">
import ReportsDailySummary from './DailySummary.vue'
import ReportsRangeReport from './RangeReport.vue'
import type { DailySummary, Report } from '#shared/types/reports'
import type { ReportRange } from '#shared/vn-date'

const api = useApi()
const { activeStore } = useActiveStore()
const isOwner = computed(() => activeStore.value?.role === 'OWNER')
const range = ref<ReportRange>('7d')
const RANGES: { value: ReportRange, label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
]

const { data: summary, status: summaryStatus, error: summaryError, refresh: refreshSummary } = await useAsyncData(
  () => `report-summary-${activeStore.value?.id ?? 'none'}`,
  async () => {
    const id = activeStore.value?.id
    return id ? await api<DailySummary>(`/api/stores/${id}/summary`) : null
  },
)

const { data: report, status: reportStatus, error: reportError, refresh: refreshReport } = await useAsyncData(
  () => `report-range-${activeStore.value?.id ?? 'none'}-${activeStore.value?.role ?? 'none'}-${range.value}`,
  async () => {
    const id = activeStore.value?.id
    return id && isOwner.value ? await api<Report>(`/api/stores/${id}/reports`, { query: { range: range.value } }) : null
  },
)

</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Báo cáo" description="Tính theo ngày giờ Việt Nam. Đã thu lấy từ các khoản thanh toán đã ghi nhận." />

    <section class="flex flex-col gap-3" aria-labelledby="today-heading">
      <h2 id="today-heading" class="text-h3 text-default">
        Hôm nay<span v-if="summary" class="text-sm font-normal text-muted"> · {{ summary.date }}</span>
      </h2>
      <div v-if="summaryStatus === 'pending' && !summary" class="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Đang tải báo cáo">
        <USkeleton v-for="i in 6" :key="i" class="h-20 w-full rounded-md" />
      </div>
      <ZAlert v-else-if="summaryError" color="error" title="Không tải được báo cáo hôm nay">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refreshSummary()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>
      <ReportsDailySummary v-else-if="summary" :summary="summary" />
    </section>

    <section v-if="isOwner" class="flex flex-col gap-3" aria-labelledby="trend-heading">
      <h2 id="trend-heading" class="text-h3 text-default">Xu hướng</h2>
      <div role="group" aria-label="Khoảng thời gian" class="flex gap-2">
        <button
          v-for="option in RANGES"
          :key="option.value"
          type="button"
          :aria-pressed="range === option.value"
          class="flex min-h-12 flex-1 items-center justify-center rounded-full border px-4 font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="range === option.value ? 'border-primary bg-primary text-(--zeno-on-primary)' : 'border-default bg-(--zeno-surface) text-muted'"
          @click="range = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div v-if="reportStatus === 'pending' && !report" class="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Đang tải báo cáo">
        <USkeleton v-for="i in 4" :key="i" class="h-20 w-full rounded-md" />
      </div>
      <ZAlert v-else-if="reportError" color="error" title="Không tải được báo cáo">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refreshReport()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>
      <ReportsRangeReport v-else-if="report" :report="report" />
    </section>
  </div>
</template>
