<script setup lang="ts">
defineProps<{
  publicSlug: string
  itemCount: number
  subtotal: string
  currency: string
}>()
</script>

<template>
  <NuxtLink
    v-if="itemCount > 0"
    data-cart-bar
    :to="`/s/${publicSlug}/cart`"
    class="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-lg items-center justify-between rounded-2xl bg-[rgb(var(--text))] px-5 py-4 font-bold text-white shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--brand))]"
  >
    <span>🛒 {{ itemCount }} món</span>
    <span>{{ formatMoney(subtotal, currency) }} →</span>
  </NuxtLink>
</template>
