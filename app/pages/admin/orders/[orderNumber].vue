<script setup lang="ts">
import type { MerchantOrderDetail, OrderStatus } from '../../../../shared/types/merchant'
import { nextOrderStatuses, orderStatusLabel } from '../../../domain/merchant-order-status'

definePageMeta({ layout: 'admin', middleware: 'merchant-auth' })
const route = useRoute()
const api = useMerchantApi()
const orderNumber = String(route.params.orderNumber)
const selectedStoreId = useState<string>('merchant-store-id', () => '')
const storeId = computed(() => String(route.query.store || selectedStoreId.value))
const actionPending = ref(false)
const actionError = ref('')

const result = await useAsyncData(
  `merchant-order:${orderNumber}`,
  () => api.request<MerchantOrderDetail>(`/api/merchant/stores/${storeId.value}/orders/${orderNumber}`),
  { watch: [storeId] },
)
const order = computed(() => result.data.value)
const nextStatuses = computed(() => order.value ? nextOrderStatuses(order.value.status, order.value.fulfillmentType) : [])

async function transition(status: OrderStatus) {
  if (!order.value || actionPending.value) return
  actionPending.value = true
  actionError.value = ''
  try {
    await api.request(`/api/merchant/stores/${storeId.value}/orders/${orderNumber}/status`, {
      method: 'PATCH', body: { status, note: null },
    })
    await result.refresh()
  }
  catch {
    actionError.value = 'Không thể cập nhật trạng thái. Hãy làm mới và thử lại.'
  }
  finally {
    actionPending.value = false
  }
}

useSeoMeta({ title: `Đơn ${orderNumber} | Zeno Merchant`, robots: 'noindex, nofollow' })
</script>

<template>
  <main class="mx-auto max-w-4xl px-4 py-6">
    <NuxtLink to="/admin/orders" class="inline-flex min-h-11 items-center font-bold text-cyan-300">← Danh sách đơn</NuxtLink>
    <p v-if="result.pending.value" class="mt-8 text-slate-400">Đang tải chi tiết…</p>
    <p v-else-if="result.error.value || !order" role="alert" class="mt-8 rounded-2xl bg-red-950 p-4 text-red-200">Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.</p>
    <template v-else>
      <header class="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-sm font-black uppercase tracking-[0.16em] text-cyan-300">Chi tiết đơn</p>
          <h1 class="mt-1 text-4xl font-black">{{ order.orderNumber }}</h1>
          <p class="mt-2 text-slate-400">{{ order.customerName }} · {{ order.customerPhone }}</p>
        </div>
        <span class="self-start rounded-full bg-cyan-950 px-4 py-2 text-sm font-black text-cyan-200">{{ orderStatusLabel[order.status] }}</span>
      </header>

      <p v-if="actionError" role="alert" class="mt-5 rounded-2xl bg-red-950 p-4 text-red-200">{{ actionError }}</p>
      <section v-if="nextStatuses.length" class="mt-6 rounded-2xl border border-white/10 bg-slate-900 p-5">
        <h2 class="font-black">Cập nhật trạng thái</h2>
        <div class="mt-3 flex flex-wrap gap-3">
          <button
            v-for="status in nextStatuses"
            :key="status"
            type="button"
            :disabled="actionPending"
            class="min-h-11 rounded-xl px-4 font-black disabled:opacity-50"
            :class="status === 'cancelled' ? 'border border-red-400/40 text-red-200' : 'bg-cyan-400 text-slate-950'"
            @click="transition(status)"
          >
            {{ orderStatusLabel[status] }}
          </button>
        </div>
      </section>

      <div class="mt-6 grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <section class="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <h2 class="text-lg font-black">Món đã đặt</h2>
          <ul class="mt-3 divide-y divide-white/10">
            <li v-for="item in order.items" :key="item.id" class="py-4">
              <div class="flex justify-between gap-4"><strong>{{ item.quantity }} × {{ item.name }}</strong><span>{{ formatMoney(item.lineTotal, 'VND') }}</span></div>
              <p v-if="item.options.length" class="mt-1 text-sm text-slate-400">{{ item.options.map(option => option.name).join(', ') }}</p>
              <p v-if="item.note" class="mt-1 text-sm text-amber-200">{{ item.note }}</p>
            </li>
          </ul>
          <div class="mt-4 flex justify-between border-t border-white/10 pt-4 text-xl"><span>Tổng cộng</span><strong>{{ formatMoney(order.total, 'VND') }}</strong></div>
        </section>

        <aside class="space-y-5">
          <section class="rounded-2xl border border-white/10 bg-slate-900 p-5">
            <h2 class="font-black">Giao nhận</h2>
            <p class="mt-2 text-sm text-slate-300">{{ order.fulfillmentType === 'pickup' ? 'Khách tự đến lấy' : order.deliveryAddress }}</p>
            <p v-if="order.deliveryNote" class="mt-2 text-sm text-slate-400">{{ order.deliveryNote }}</p>
            <p v-if="order.customerNote" class="mt-3 text-sm text-amber-200">{{ order.customerNote }}</p>
          </section>
          <section class="rounded-2xl border border-white/10 bg-slate-900 p-5">
            <h2 class="font-black">Lịch sử</h2>
            <ol class="mt-3 space-y-3 text-sm">
              <li v-for="entry in order.history" :key="`${entry.createdAt}:${entry.toStatus}`">
                <strong>{{ orderStatusLabel[entry.toStatus] }}</strong>
                <p class="text-slate-500">{{ new Date(entry.createdAt).toLocaleString('vi-VN') }}</p>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </template>
  </main>
</template>
