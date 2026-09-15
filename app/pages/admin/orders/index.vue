<script setup lang="ts">
import type { MerchantOrderListResponse, MerchantStoreSummary, OrderStatus } from '../../../../shared/types/merchant'
import { orderStatusLabel } from '../../../domain/merchant-order-status'

definePageMeta({ layout: 'admin', middleware: 'merchant-auth' })
const api = useMerchantApi()
const selectedStoreId = useState<string>('merchant-store-id', () => '')
const status = ref<OrderStatus | ''>('')

const storesResult = await useAsyncData('merchant-stores', () => api.request<{ stores: MerchantStoreSummary[] }>('/api/merchant/stores'))
const stores = computed(() => storesResult.data.value?.stores ?? [])
if (!selectedStoreId.value && stores.value[0]) selectedStoreId.value = stores.value[0].id

const ordersResult = await useAsyncData(
  'merchant-orders',
  () => selectedStoreId.value
    ? api.request<MerchantOrderListResponse>(`/api/merchant/stores/${selectedStoreId.value}/orders`, {
        query: { status: status.value || undefined, limit: 100 },
      })
    : Promise.resolve({ orders: [] }),
  { watch: [selectedStoreId, status] },
)
const orders = computed(() => ordersResult.data.value?.orders ?? [])
useMerchantOrderRealtime(selectedStoreId, ordersResult.refresh)

function formatTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

useSeoMeta({ title: 'Đơn hàng | Zeno Merchant', robots: 'noindex, nofollow' })
</script>

<template>
  <main class="mx-auto max-w-6xl px-4 py-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm font-black uppercase tracking-[0.16em] text-cyan-300">Vận hành trực tiếp</p>
        <h1 class="mt-1 text-3xl font-black">Đơn hàng</h1>
      </div>
      <button type="button" class="min-h-11 rounded-xl border border-white/15 px-4 font-bold" @click="ordersResult.refresh()">
        Làm mới
      </button>
    </div>

    <div class="mt-6 grid gap-3 sm:grid-cols-2">
      <label class="text-sm font-bold">Cửa hàng
        <select v-model="selectedStoreId" class="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-slate-900 px-3">
          <option v-for="store in stores" :key="store.id" :value="store.id">{{ store.name }}</option>
        </select>
      </label>
      <label class="text-sm font-bold">Trạng thái
        <select v-model="status" class="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-slate-900 px-3">
          <option value="">Tất cả trạng thái</option>
          <option v-for="(label, value) in orderStatusLabel" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
    </div>

    <p v-if="storesResult.error.value" role="alert" class="mt-6 rounded-2xl bg-red-950 p-4 text-red-200">Không thể tải cửa hàng được phân quyền.</p>
    <p v-else-if="ordersResult.pending.value" class="mt-8 text-slate-400">Đang tải đơn hàng…</p>
    <p v-else-if="orders.length === 0" class="mt-8 rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">Chưa có đơn phù hợp.</p>

    <ul v-else class="mt-6 grid gap-3 lg:grid-cols-2">
      <li v-for="order in orders" :key="order.id">
        <NuxtLink
          :to="{ path: `/admin/orders/${order.orderNumber}`, query: { store: selectedStoreId } }"
          class="block rounded-2xl border border-white/10 bg-slate-900 p-5 transition hover:border-cyan-400/60"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xl font-black">{{ order.orderNumber }}</p>
              <p class="mt-1 text-sm text-slate-400">{{ order.customerName }} · {{ order.fulfillmentType === 'pickup' ? 'Tự lấy' : 'Giao hàng' }}</p>
            </div>
            <span class="rounded-full bg-cyan-950 px-3 py-1 text-xs font-black text-cyan-200">{{ orderStatusLabel[order.status] }}</span>
          </div>
          <div class="mt-5 flex items-end justify-between gap-4">
            <span class="text-xs text-slate-500">{{ formatTime(order.createdAt) }}</span>
            <strong class="text-xl">{{ formatMoney(order.total, stores.find(store => store.id === selectedStoreId)?.currency ?? 'VND') }}</strong>
          </div>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>
