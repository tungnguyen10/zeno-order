<script setup lang="ts">
import type { Resolution } from '#shared/payments'
import type { OverdueOrder, RefundDueOrder, ReviewItem } from '#shared/types/reconciliation'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Đối soát' })

type Tab = 'review' | 'refund' | 'overdue' | 'resolved'

const { activeStore } = useActiveStore()
const reconciliation = useReconciliation()
const badge = useReconciliationBadge()
const toast = useToast()

const isOwner = computed(() => activeStore.value?.role === 'OWNER')
const tab = ref<Tab>('review')
const loading = ref(true)
const errorMessage = ref('')
const busyId = ref<string | null>(null)
const review = ref<ReviewItem[]>([])
const resolved = ref<ReviewItem[]>([])
const refunds = ref<RefundDueOrder[]>([])
const overdue = ref<OverdueOrder[]>([])

const tabs = computed(() => [
  { key: 'review' as const, label: 'Cần xử lý', count: review.value.length },
  { key: 'refund' as const, label: 'Hoàn tiền', count: refunds.value.length },
  { key: 'overdue' as const, label: 'Quá hạn', count: overdue.value.length },
  { key: 'resolved' as const, label: 'Đã xử lý', count: 0 },
])

let loadVersion = 0
async function load() {
  const version = ++loadVersion
  const storeId = activeStore.value?.id
  if (!isOwner.value) return
  try {
    const [a, b, c, d] = await Promise.all([
      reconciliation.listReview('REVIEW_REQUIRED'),
      reconciliation.listRefunds(),
      reconciliation.listOverdue(),
      tab.value === 'resolved' ? reconciliation.listReview('RESOLVED') : Promise.resolve({ items: resolved.value }),
    ])
    if (version !== loadVersion || activeStore.value?.id !== storeId || !isOwner.value) return
    review.value = a.items
    refunds.value = b.items
    overdue.value = c.items
    resolved.value = d.items
    errorMessage.value = ''
    void badge.refresh()
  }
  catch (err) {
    if (version === loadVersion) errorMessage.value = extractApiError(err).message
  }
  finally {
    if (version === loadVersion) loading.value = false
  }
}

async function run(id: string, action: () => Promise<unknown>, success: string) {
  busyId.value = id
  try {
    await action()
    toast.add({ title: success, color: 'success' })
  }
  catch (err) {
    const error = extractApiError(err)
    const message = error.code === 'STATUS_CONFLICT' ? 'Mục này vừa được xử lý ở nơi khác, đã tải lại danh sách' : error.message
    toast.add({ title: message, color: 'error' })
  }
  finally {
    busyId.value = null
    await load()
  }
}

const assign = (item: ReviewItem, orderId: string, accept: boolean) =>
  run(item.id, () => reconciliation.assign(item.id, orderId, accept), 'Đã gán vào đơn')
const resolve = (item: ReviewItem, resolution: Resolution, note: string | undefined) =>
  run(item.id, () => reconciliation.resolve(item.id, resolution, note), 'Đã đánh dấu xử lý')
const refund = (order: RefundDueOrder, note: string) =>
  run(order.id, () => reconciliation.markRefunded(order.id, note, order.heldVnd), 'Đã ghi nhận hoàn tiền')
const payManually = (order: OverdueOrder, note: string) =>
  run(order.id, () => reconciliation.markPaidManually(order.id, order.paymentStatus, note), 'Đã xác nhận thu tiền')

async function select(next: Tab) {
  tab.value = next
  if (next === 'resolved') await load()
}

watch(() => activeStore.value?.id, () => {
  loadVersion++
  review.value = []
  resolved.value = []
  refunds.value = []
  overdue.value = []
  tab.value = 'review'
  errorMessage.value = ''
  loading.value = true
  void load()
}, { flush: 'sync' })

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && busyId.value === null) void load()
  }, 15_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppPageHeader title="Đối soát" description="Tiền đã vào tài khoản nhưng chưa khớp đơn, và các khoản cần hoàn." />

    <ZAlert v-if="!isOwner" color="warning" title="Chỉ chủ quán xem được mục này" />

    <template v-else>
      <div role="tablist" aria-label="Nhóm đối soát" class="flex gap-2 overflow-x-auto pb-1">
        <ZButton
          v-for="t in tabs"
          :key="t.key"
          role="tab"
          size="sm"
          :aria-selected="tab === t.key"
          :variant="tab === t.key ? 'primary' : 'secondary'"
          @click="select(t.key)"
        >
          {{ t.label }}<span v-if="t.count" class="ms-1 font-mono">({{ t.count }})</span>
        </ZButton>
      </div>

      <ZAlert v-if="errorMessage" color="error" title="Không tải được danh sách" :description="errorMessage">
        <template #actions>
          <ZButton variant="secondary" size="sm" @click="load">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>
      <p v-else-if="loading" role="status" class="text-muted">
        Đang tải…
      </p>

      <template v-else>
        <section v-if="tab === 'review'" class="flex flex-col gap-3" aria-label="Giao dịch cần xử lý">
          <AppEmptyState v-if="review.length === 0" icon="i-lucide-circle-check" title="Không có giao dịch nào cần xử lý" description="Tiền khách chuyển khớp đơn sẽ tự được xác nhận." />
          <AppReconciliationReviewCard
            v-for="item in review"
            :key="item.id"
            :item="item"
            :busy="busyId === item.id"
            @assign="(orderId, accept) => assign(item, orderId, accept)"
            @resolve="(resolution, note) => resolve(item, resolution, note)"
          />
        </section>

        <section v-else-if="tab === 'refund'" class="flex flex-col gap-3" aria-label="Đơn cần hoàn tiền">
          <AppEmptyState v-if="refunds.length === 0" icon="i-lucide-hand-coins" title="Không có khoản nào cần hoàn" />
          <AppReconciliationOrderCard v-for="order in refunds" :key="order.id" kind="refund" :order="order" :busy="busyId === order.id" @confirm="note => refund(order, note)" />
        </section>

        <section v-else-if="tab === 'overdue'" class="flex flex-col gap-3" aria-label="Đơn quá hạn thanh toán">
          <AppEmptyState v-if="overdue.length === 0" icon="i-lucide-clock" title="Không có đơn nào quá hạn" description="Đơn chờ chuyển khoản mà mã QR đã hết hạn sẽ hiện ở đây." />
          <AppReconciliationOrderCard v-for="order in overdue" :key="order.id" kind="overdue" :order="order" :busy="busyId === order.id" @confirm="note => payManually(order, note)" />
        </section>

        <section v-else class="flex flex-col gap-3" aria-label="Đã xử lý">
          <AppEmptyState v-if="resolved.length === 0" icon="i-lucide-history" title="Chưa có giao dịch nào được xử lý" />
          <AppReconciliationReviewCard v-for="item in resolved" :key="item.id" :item="item" />
        </section>
      </template>
    </template>
  </div>
</template>
