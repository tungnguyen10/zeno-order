<script setup lang="ts">
import type { PublicStoreSummary } from '../../../../shared/types/storefront'

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

function changeQuantity(lineId: string, quantity: number) {
  if (quantity < 1 || quantity > 99) {
    return
  }
  cart.updateQuantity(publicSlug, lineId, quantity)
}

useSeoMeta({
  title: `Giỏ hàng | ${store.name}`,
  description: `Kiểm tra giỏ hàng tại ${store.name}.`,
})
</script>

<template>
  <main class="min-h-screen bg-[rgb(var(--background))] px-4 py-6 sm:px-6">
    <div class="mx-auto max-w-2xl">
      <NuxtLink
        data-menu-link
        :to="`/s/${publicSlug}`"
        class="inline-flex min-h-11 items-center font-bold text-[rgb(var(--brand))]"
      >
        ← Quay lại thực đơn
      </NuxtLink>

      <header class="mt-4">
        <p class="text-sm font-bold text-[rgb(var(--muted))]">
          {{ store.name }}
        </p>
        <h1 class="mt-1 text-3xl font-black tracking-tight">
          Giỏ hàng
        </h1>
      </header>

      <section
        v-if="items.length === 0"
        class="mt-8 rounded-[var(--radius-card)] border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-5 py-12 text-center"
      >
        <h2 class="text-xl font-black">
          Giỏ hàng đang trống
        </h2>
        <p class="mt-2 text-sm text-[rgb(var(--muted))]">
          Chọn món từ thực đơn để bắt đầu đơn hàng.
        </p>
      </section>

      <template v-else>
        <div class="mt-6 space-y-4">
          <CartItem
            v-for="item in items"
            :key="item.id"
            :item="item"
            :currency="currency"
            @decrease="changeQuantity(item.id, item.quantity - 1)"
            @increase="changeQuantity(item.id, item.quantity + 1)"
            @remove="cart.removeItem(publicSlug, item.id)"
          />
        </div>

        <div class="mt-6 space-y-4">
          <CartSummary
            :item-count="cart.itemCount(publicSlug)"
            :subtotal="cart.subtotal(publicSlug)"
            :currency="currency"
          />
          <NuxtLink
            data-checkout-link
            :to="`/s/${publicSlug}/checkout`"
            class="flex min-h-14 w-full items-center justify-center rounded-2xl bg-[rgb(var(--brand))] px-5 py-4 text-center font-black text-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--brand))]"
          >
            Tiếp tục thanh toán
          </NuxtLink>
        </div>
      </template>
    </div>
  </main>
</template>
