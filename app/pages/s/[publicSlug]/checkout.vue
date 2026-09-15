<script setup lang="ts">
import type { PublicStoreSummary } from '../../../../shared/types/storefront'
import type { CheckoutDraft, CreateOrderResponse } from '../../../../shared/types/order'
import { calculateLineTotal } from '../../../domain/cart'
import { createCheckoutAttemptManager } from '../../../domain/checkout-attempt'

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
const runtimeConfig = useRuntimeConfig()
const pending = shallowRef(false)
const submitError = shallowRef('')
const attempt = createCheckoutAttemptManager()

onMounted(() => {
  cart.hydrate(publicSlug, currency)
})

async function submitOrder(draft: CheckoutDraft) {
  if (pending.value || items.value.length === 0) return
  const orderItems = items.value.map(item => ({
    productId: item.productId,
    quantity: item.quantity,
    optionValueIds: item.options.map(option => option.optionValueId),
    note: item.note,
  }))
  const businessPayload = {
    publicSlug,
    fulfillmentType: draft.fulfillmentType,
    customer: draft.customer,
    delivery: draft.delivery,
    customerNote: draft.customerNote,
    paymentMethod: draft.paymentMethod,
    items: orderItems,
  }
  const idempotencyKey = attempt.keyFor(JSON.stringify(businessPayload))

  pending.value = true
  submitError.value = ''
  try {
    const response = await $fetch<CreateOrderResponse>('/api/orders', {
      method: 'POST',
      body: { ...businessPayload, idempotencyKey, turnstileToken: draft.turnstileToken },
    })
    cart.clear(publicSlug)
    attempt.reset()
    await navigateTo(response.trackingPath)
  }
  catch (error) {
    const payload = (error as { data?: { error?: { message?: string } } }).data
    submitError.value = payload?.error?.message ?? 'Không thể đặt đơn. Vui lòng thử lại.'
  }
  finally {
    pending.value = false
  }
}

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

        <p v-if="submitError" role="alert" class="mt-5 rounded-2xl bg-[rgb(var(--danger-soft))] p-4 font-semibold text-[rgb(var(--danger))]">
          {{ submitError }}
        </p>
        <section class="mt-6">
          <CheckoutForm
            :pending="pending"
            :site-key="runtimeConfig.public.turnstileSiteKey"
            @submit="submitOrder"
          />
        </section>
      </template>
    </div>
  </main>
</template>
