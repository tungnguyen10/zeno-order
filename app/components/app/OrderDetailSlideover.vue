<script setup lang="ts">
import { PAYMENT_METHOD_LABELS, paymentTone, describeEvent, formatDateTime } from '~/utils/order-view'
import type { OrderStatus } from '#shared/enums'
import { formatVnd } from '#shared/money'
import {
  FULFILLMENT_LABELS, PAYMENT_STATUS_LABELS, STATUS_LABELS,
  advanceTargets, canCancelOrder, canMarkCashPaid, transitionLabel,
} from '#shared/order-flow'
import type { OrderDetailResponse } from '#shared/types/orders'

const props = defineProps<{ storeId: string, orderId: string | null, role: 'OWNER' | 'STAFF' }>()
const emit = defineEmits<{ close: [], changed: [] }>()

const api = useApi()
const toast = useToast()

const detail = ref<OrderDetailResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const acting = ref<string | null>(null)
const showCancel = ref(false)
const reason = ref('')
let loadVersion = 0
const context = () => `${props.storeId}:${props.orderId}`
onBeforeUnmount(() => { loadVersion++ })
const QUICK_REASONS = ['Hết nguyên liệu', 'Khách yêu cầu hủy', 'Không liên lạc được khách']

const open = computed({
  get: () => props.orderId !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})
const base = computed(() => `/api/stores/${props.storeId}/orders/${props.orderId}`)

async function load() {
  if (!props.orderId) return
  const mine = ++loadVersion
  const current = context()
  loading.value = detail.value?.order.id !== props.orderId
  error.value = null
  try {
    const response = await api<OrderDetailResponse>(base.value)
    if (mine === loadVersion && current === context()) detail.value = response
  }
  catch (err) {
    if (mine === loadVersion && current === context()) error.value = extractApiError(err).message
  }
  finally {
    if (mine === loadVersion && current === context()) loading.value = false
  }
}

watch(() => [props.storeId, props.orderId], () => {
  loadVersion++
  acting.value = null
  detail.value = null
  showCancel.value = false
  reason.value = ''
  if (props.orderId) void load()
}, { immediate: true })

async function run(kind: string, request: () => Promise<unknown>) {
  if (acting.value || !order.value) return
  const current = context()
  acting.value = kind
  try {
    await request()
    if (current === context()) {
      showCancel.value = false
      reason.value = ''
    }
  }
  catch (err) {
    if (current === context()) toast.add(orderActionToast(err))
  }
  finally {
    if (current === context()) {
      acting.value = null
      emit('changed')
      await load()
    }
  }
}

const order = computed(() => detail.value?.order ?? null)
const targets = computed(() => (order.value ? advanceTargets(order.value) : []))
const cancellable = computed(() => !!order.value && canCancelOrder(order.value, props.role))
const needsOwnerToCancel = computed(() => !!order.value && !cancellable.value && canCancelOrder(order.value, 'OWNER'))
const canPay = computed(() => !!order.value && canMarkCashPaid(order.value))

const advance = (status: OrderStatus) => run('advance', () =>
  api(`${base.value}/status`, { method: 'PATCH', body: { expectedStatus: order.value!.status, nextStatus: status } }))
const markPaid = () => run('pay', () =>
  api(`${base.value}/mark-paid`, { method: 'POST', body: { expectedPaymentStatus: order.value!.paymentStatus, method: 'CASH' } }))
const cancel = () => run('cancel', () =>
  api(`${base.value}/cancel`, { method: 'POST', body: { expectedStatus: order.value!.status, reason: reason.value } }))
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :title="order ? `Đơn ${order.publicCode}` : 'Chi tiết đơn'"
    description="Chi tiết, thao tác và lịch sử của đơn hàng"
    :ui="{ content: 'w-full max-w-md' }"
  >
    <template #body>
      <div v-if="loading" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải đơn">
        <USkeleton v-for="i in 4" :key="i" class="h-20 w-full rounded-md" />
      </div>

      <ZAlert v-else-if="error && !order" color="error" title="Không tải được đơn" :description="error">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="load()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>

      <div v-else-if="order" class="flex flex-col gap-5" data-testid="order-detail">
        <ZAlert v-if="error" color="warning" title="Không cập nhật được đơn" :description="error" />
        <div class="flex flex-wrap items-center gap-2">
          <ZBadge :status="order.status === 'CANCELLED' ? 'error' : 'info'">{{ STATUS_LABELS[order.status] }}</ZBadge>
          <ZBadge :status="paymentTone(order.paymentStatus)">{{ PAYMENT_STATUS_LABELS[order.paymentStatus] }}</ZBadge>
          <ZBadge v-if="order.latePayment" status="warning">Chuyển muộn</ZBadge>
          <span class="text-sm text-muted">{{ FULFILLMENT_LABELS[order.fulfillmentType] }}<template v-if="order.tableName"> · {{ order.tableName }}</template> · {{ formatDateTime(order.createdAt) }}</span>
        </div>

        <section v-if="order.customerName || order.customerPhone || order.address || order.notes" class="flex flex-col gap-2">
          <p v-if="order.customerName" class="font-medium text-default">{{ order.customerName }}</p>
          <ZButton v-if="order.customerPhone" variant="secondary" icon="i-lucide-phone" :to="`tel:${order.customerPhone}`">
            Gọi {{ order.customerPhone }}
          </ZButton>
          <p v-if="order.address" class="text-sm text-default">{{ order.address }}</p>
          <p v-if="order.notes" class="rounded-md bg-(--zeno-surface-inset) px-3 py-2 text-sm text-default">Ghi chú: {{ order.notes }}</p>
        </section>

        <section aria-label="Món đã đặt">
          <ul class="flex flex-col gap-2">
            <li v-for="item in order.items" :key="item.id" class="flex items-start justify-between gap-3">
              <span class="min-w-0">
                <span class="font-semibold">{{ item.qty }}×</span> {{ item.name }}
                <span v-if="item.options.length" class="block text-[13px] text-muted">{{ item.options.join(', ') }}</span>
              </span>
              <span class="shrink-0 font-mono text-sm">{{ formatVnd(item.lineTotalVnd) }}</span>
            </li>
          </ul>
          <p class="mt-3 flex justify-between border-t border-default pt-3 font-semibold">
            <span>Tổng</span><span class="font-mono">{{ formatVnd(order.totalVnd) }}</span>
          </p>
          <p v-if="detail?.payment" class="mt-1 text-sm text-muted">
            Đã thu {{ formatVnd(detail.payment.amountVnd) }} bằng {{ PAYMENT_METHOD_LABELS[detail.payment.method] }} lúc {{ formatDateTime(detail.payment.recordedAt) }}<template v-if="detail.payment.note"> — {{ detail.payment.note }}</template>
          </p>
        </section>

        <section v-if="targets.length || canPay || cancellable || needsOwnerToCancel" class="flex flex-col gap-2" aria-label="Thao tác">
          <ZButton
            v-for="(status, index) in targets"
            :key="status"
            size="lg"
            block
            :variant="index === 0 ? 'primary' : 'secondary'"
            :loading="acting === 'advance'"
            :disabled="acting !== null"
            @click="advance(status)"
          >
            {{ transitionLabel(order, status) }}
          </ZButton>
          <ZButton v-if="canPay" variant="secondary" size="lg" block icon="i-lucide-banknote" :loading="acting === 'pay'" :disabled="acting !== null" @click="markPaid()">
            Đã thu tiền mặt
          </ZButton>
          <ZAlert v-if="needsOwnerToCancel" color="info" title="Đơn đã thu tiền — chỉ chủ quán được hủy" />
          <ZButton v-if="cancellable && !showCancel" variant="ghost" size="lg" block icon="i-lucide-x" @click="showCancel = true">
            Hủy đơn
          </ZButton>
          <div v-if="cancellable && showCancel" class="flex flex-col gap-3 rounded-md border border-default p-3" data-testid="cancel-panel">
            <ZFormField label="Lý do hủy" name="reason" required>
              <ZInput v-model="reason" size="lg" maxlength="200" placeholder="Nhập lý do" />
            </ZFormField>
            <div class="flex flex-wrap gap-2">
              <ZButton v-for="quick in QUICK_REASONS" :key="quick" variant="secondary" size="sm" @click="reason = quick">
                {{ quick }}
              </ZButton>
            </div>
            <p v-if="order.paymentStatus === 'PAID'" class="text-sm text-muted">Đơn đã thu tiền sẽ chuyển sang "Cần hoàn tiền".</p>
            <ZButton variant="destructive" size="lg" block :disabled="reason.trim().length < 2 || acting !== null" :loading="acting === 'cancel'" @click="cancel()">
              Xác nhận hủy đơn
            </ZButton>
          </div>
        </section>

        <section aria-label="Lịch sử">
          <h3 class="mb-2 text-sm font-semibold text-muted">Lịch sử</h3>
          <ol class="flex flex-col gap-2">
            <li v-for="event in detail?.events" :key="event.id" class="flex justify-between gap-3 text-sm">
              <span class="text-default">{{ describeEvent(event) }}<span v-if="event.actorName" class="text-muted"> · {{ event.actorName }}</span></span>
              <span class="shrink-0 text-muted">{{ formatDateTime(event.createdAt) }}</span>
            </li>
            <li v-if="!detail?.events.length" class="text-sm text-muted">Chưa có thao tác nào.</li>
          </ol>
        </section>
      </div>
    </template>
  </USlideover>
</template>
