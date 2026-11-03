<script setup lang="ts">
import { isTerminalStatus } from '#shared/enums'
import { formatVnd } from '#shared/money'
import type { PublicOrderView } from '#shared/types/order'

definePageMeta({ key: route => String(route.params.token) })

useHead({ title: 'Theo dõi đơn hàng', meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] })

const route = useRoute()
const token = String(route.params.token ?? '')
const origin = useRequestURL().origin
const toast = useToast()
const repaying = shallowRef(false)

async function repay() {
  if (repaying.value) return
  repaying.value = true
  try {
    await $fetch(`/api/public/orders/${encodeURIComponent(token)}/payment-attempts`, { method: 'POST' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    try { await refresh() }
    finally { repaying.value = false }
  }
}

const order = ref<PublicOrderView | null>(null)
const loading = ref(true)
const notFound = ref(false)
const connectionLost = ref(false)

async function refresh() {
  try {
    order.value = await $fetch<PublicOrderView>(`/api/public/orders/${encodeURIComponent(token)}`)
    connectionLost.value = false
    notFound.value = false
  }
  catch (err) {
    if (extractApiError(err).code === 'NOT_FOUND') notFound.value = true
    else connectionLost.value = true
  }
  finally {
    loading.value = false
  }
}

const finished = computed(() => (order.value ? isTerminalStatus(order.value.status) : false))
useVisiblePolling(refresh, { intervalMs: 4000, enabled: () => !notFound.value && !finished.value })
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pb-10 pt-[calc(1.25rem+env(safe-area-inset-top))]">
    <div v-if="loading" class="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải đơn hàng">
      <div class="h-24 w-full animate-pulse rounded-md bg-(--zeno-surface-inset)" />
      <div class="h-48 w-full animate-pulse rounded-md bg-(--zeno-surface-inset)" />
      <div class="h-32 w-full animate-pulse rounded-md bg-(--zeno-surface-inset)" />
    </div>

    <AppEmptyState
      v-else-if="notFound"
      icon="i-lucide-search-x"
      heading-level="h1"
      title="Không tìm thấy đơn hàng"
      description="Link có thể bị thiếu hoặc sai. Hãy mở lại link bạn đã lưu, hoặc hỏi quán."
    />

    <ZAlert v-else-if="!order && connectionLost" color="warning" title="Chưa tải được đơn hàng" description="Kiểm tra kết nối mạng rồi thử lại.">
      <template #actions>
        <ZButton variant="secondary" @click="refresh">Thử lại</ZButton>
      </template>
    </ZAlert>

    <template v-else-if="order">
      <header class="flex flex-col gap-2">
        <p class="text-sm text-muted">
          {{ order.store.name }}
        </p>
        <h1 class="text-h2 text-default">
          Đơn <span class="font-mono" data-testid="order-public-code">#{{ order.publicCode }}</span>
        </h1>
        <div>
          <ZBadge :status="customerStatusTone(order.status)" data-testid="order-status">
            {{ customerStatusLabel(order.status, order.fulfillmentType) }}
          </ZBadge>
        </div>
      </header>

      <ZAlert v-if="connectionLost" color="warning" title="Mất kết nối" description="Đang thử lại. Trạng thái bên dưới có thể chưa mới nhất." />
      <ZAlert
        v-if="order.status === 'CANCELLED'"
        color="error"
        title="Quán đã hủy đơn này"
        description="Nếu bạn đã chuyển tiền, vui lòng liên hệ quán để được hoàn lại."
      />

      <OrderPaymentPanel
        v-if="order.paymentMethod === 'BANK_QR' && order.status === 'AWAITING_PAYMENT' && order.paymentStatus === 'PENDING'"
        :qr="order.qr"
        :total-vnd="order.totalVnd"
        :public-code="order.publicCode"
        :repaying="repaying"
        @repay="repay"
        @expired="refresh"
      />
      <ZAlert
        v-if="order.paymentMethod === 'BANK_QR' && ['REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED'].includes(order.paymentStatus)"
        color="info"
        :title="order.paymentStatus === 'REVIEW_REQUIRED' ? 'Cửa hàng đang đối soát thanh toán' : 'Cửa hàng đang xử lý hoàn tiền'"
        description="Nếu bạn đã chuyển khoản, đừng chuyển lại. Vui lòng liên hệ cửa hàng để được hỗ trợ."
      />
      <ZAlert v-if="order.paymentStatus === 'PAID'" color="success" title="Đã thanh toán" description="Cửa hàng đã nhận được thanh toán của bạn." />

      <ZCard v-if="order.status !== 'CANCELLED'" variant="elevated" padding="md">
        <OrderStatusSteps :status="order.status" :fulfillment-type="order.fulfillmentType" />
      </ZCard>

      <ZCard variant="flat" padding="md">
        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-muted">
              Nhận món
            </dt>
            <dd class="text-end text-default">
              {{ fulfillmentSummary(order) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted">
              Thanh toán
            </dt>
            <dd class="text-end text-default">
              {{ customerPaymentLabel(order.paymentMethod, order.paymentStatus) }}
            </dd>
          </div>
          <div v-if="order.customerName || order.phoneMasked" class="flex justify-between gap-4">
            <dt class="text-muted">
              Người nhận
            </dt>
            <dd class="break-words text-end text-default">
              {{ order.customerName }}<template v-if="order.phoneMasked"> · <span class="font-mono">{{ order.phoneMasked }}</span></template>
            </dd>
          </div>
        </dl>
      </ZCard>

      <ZCard variant="flat" padding="md">
        <ul class="flex flex-col gap-3">
          <li v-for="(item, index) in order.items" :key="index" class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="break-words font-medium text-default">
                {{ item.quantity }} × {{ item.name }}
              </p>
              <p v-if="item.options.length" class="break-words text-sm text-muted">
                {{ item.options.map(option => option.name).join(' · ') }}
              </p>
              <p v-if="item.note" class="break-words text-sm text-muted">
                Ghi chú: {{ item.note }}
              </p>
            </div>
            <p class="shrink-0 font-mono text-sm text-default">
              {{ formatVnd(item.lineTotalVnd) }}
            </p>
          </li>
        </ul>
        <dl class="mt-4 flex flex-col gap-1 border-t border-default pt-3 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">
              Tạm tính
            </dt>
            <dd class="font-mono">
              {{ formatVnd(order.subtotalVnd) }}
            </dd>
          </div>
          <div v-if="order.fulfillmentType === 'DELIVERY'" class="flex justify-between">
            <dt class="text-muted">
              Phí giao
            </dt>
            <dd class="font-mono">
              {{ formatVnd(order.deliveryFeeVnd) }}
            </dd>
          </div>
          <div class="flex justify-between text-base font-semibold">
            <dt>Tổng cộng</dt>
            <dd class="font-mono">
              {{ formatVnd(order.totalVnd) }}
            </dd>
          </div>
        </dl>
      </ZCard>

      <ZCard variant="flat" padding="md">
        <AppCopyField :value="`${origin}/o/${token}`" label="Link theo dõi đơn" />
        <p class="mt-2 text-[13px] text-muted">
          Lưu link này để xem lại đơn bất cứ lúc nào. Đừng chia sẻ cho người lạ.
        </p>
      </ZCard>

      <ZButton :to="`/s/${order.store.slug}`" variant="secondary" block icon="i-lucide-plus">
        Đặt thêm món
      </ZButton>
    </template>
  </div>
</template>
