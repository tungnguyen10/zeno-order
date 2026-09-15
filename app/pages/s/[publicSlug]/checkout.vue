<script setup lang="ts">
import type { PublicStoreSummary } from '../../../../shared/types/storefront'
import { calculateLineTotal } from '../../../domain/cart'

const route = useRoute()
const publicSlug = String(route.params.publicSlug)
const result = await useFetch<PublicStoreSummary>(
  `/api/storefront/${publicSlug}`,
  { key: `storefront-profile:${publicSlug}` },
)
const store = result.data.value
const pageError = getStorefrontPageError(result.error.value, Boolean(store))

if (pageError || !store) {
  throw createError(pageError ?? {
    statusCode: 500,
    statusMessage: 'Không thể tải thông tin cửa hàng.',
  })
}

const currency = store.currency
const cart = useCartStore()
const items = computed(() => cart.cartFor(publicSlug)?.items ?? [])

onMounted(() => {
  cart.hydrate(publicSlug, currency)
})

useSeoMeta({
  title: `Thanh toán | ${store.name}`,
  description: `Xem tóm tắt đơn hàng tại ${store.name}.`,
})
</script>

<template>
  <main class="min-h-screen bg-[rgb(var(--background))] px-4 py-6 sm:px-6">
    <div class="mx-auto max-w-2xl">
      <NuxtLink
        data-cart-link
        :to="`/s/${publicSlug}/cart`"
        class="inline-flex min-h-11 items-center font-bold text-[rgb(var(--brand))]"
      >
        ← Quay lại giỏ hàng
      </NuxtLink>

      <header class="mt-4">
        <p class="text-sm font-bold text-[rgb(var(--muted))]">
          {{ store.name }}
        </p>
        <h1 class="mt-1 text-3xl font-black tracking-tight">
          Thanh toán
        </h1>
      </header>

      <section
        v-if="items.length === 0"
        class="mt-8 rounded-[var(--radius-card)] border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-5 py-12 text-center"
      >
        <h2 class="text-xl font-black">
          Chưa có món để thanh toán
        </h2>
        <p class="mt-2 text-sm text-[rgb(var(--muted))]">
          Quay lại giỏ hàng hoặc thực đơn để chọn món.
        </p>
      </section>

      <template v-else>
        <section class="mt-6 rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-[var(--shadow-card)]">
          <h2 class="text-lg font-black">
            Tóm tắt đơn hàng
          </h2>
          <ul class="mt-4 divide-y divide-[rgb(var(--border))]">
            <li
              v-for="item in items"
              :key="item.id"
              class="flex justify-between gap-4 py-3 text-sm"
            >
              <span>{{ item.quantity }} × {{ item.productName }}</span>
              <span class="font-bold">{{ formatMoney(calculateLineTotal(item), currency) }}</span>
            </li>
          </ul>
          <div class="mt-3 flex items-end justify-between gap-4 border-t border-[rgb(var(--border))] pt-4">
            <span class="font-bold">Tạm tính</span>
            <strong
              data-checkout-total
              class="text-2xl"
            >{{ formatMoney(cart.subtotal(publicSlug), currency) }}</strong>
          </div>
        </section>

        <section class="mt-6 rounded-[var(--radius-card)] border border-[rgb(var(--brand))]/20 bg-[rgb(var(--brand-soft))] p-5">
          <h2 class="font-black text-[rgb(var(--brand))]">
            Checkout đang được hoàn thiện
          </h2>
          <p class="mt-2 text-sm leading-6 text-[rgb(var(--muted))]">
            Đặt đơn sẽ được mở ở R4 sau khi có xác minh chống bot, tính giá phía máy chủ và idempotency.
          </p>
        </section>
      </template>
    </div>
  </main>
</template>
