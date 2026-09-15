<script setup lang="ts">
import type { PublicOrderTracking } from '../../../../../shared/types/tracking'
import { consumeTrackingToken } from '../../../../domain/tracking-session'

const route = useRoute()
const publicSlug = String(route.params.publicSlug)
const orderNumber = String(route.params.orderNumber)
const order = shallowRef<PublicOrderTracking | null>(null)
const loading = shallowRef(true)
const errorMessage = shallowRef('')
let token: string | null = null

async function refreshOrder() {
  if (!token) {
    loading.value = false
    errorMessage.value = 'Không tìm thấy thông tin theo dõi trên thiết bị này.'
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    order.value = await $fetch<PublicOrderTracking>(
      `/api/storefront/${publicSlug}/orders/${orderNumber}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  }
  catch {
    errorMessage.value = 'Không thể tải trạng thái đơn hàng.'
  }
  finally {
    loading.value = false
  }
}

function handleVisibility() {
  if (document.visibilityState === 'visible') void refreshOrder()
}

onMounted(() => {
  token = consumeTrackingToken({
    publicSlug,
    orderNumber,
    hash: window.location.hash,
    pathname: window.location.pathname,
    search: window.location.search,
    storage: window.sessionStorage,
    replaceUrl: url => window.history.replaceState(null, '', url),
  })
  void refreshOrder()
  document.addEventListener('visibilitychange', handleVisibility)
})

onBeforeUnmount(() => document.removeEventListener('visibilitychange', handleVisibility))

useSeoMeta({
  title: `Theo dõi đơn ${orderNumber}`,
  robots: 'noindex, nofollow',
})
useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })
</script>

<template>
  <main class="min-h-screen bg-[rgb(var(--background))] px-4 py-6 sm:px-6">
    <div class="mx-auto max-w-2xl">
      <p v-if="loading" class="rounded-[var(--radius-card)] bg-white p-6 font-bold">Đang tải trạng thái đơn…</p>
      <div v-else-if="errorMessage" class="rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-white p-6">
        <h1 class="text-2xl font-black">Chưa tải được đơn hàng</h1>
        <p role="alert" class="mt-2 text-[rgb(var(--muted))]">{{ errorMessage }}</p>
      </div>
      <TrackingOrderReceipt v-else-if="order" :order="order" />
      <button type="button" class="mt-5 min-h-12 w-full rounded-2xl border border-[rgb(var(--brand))] font-black text-[rgb(var(--brand))]" @click="refreshOrder">
        Cập nhật trạng thái
      </button>
    </div>
  </main>
</template>
