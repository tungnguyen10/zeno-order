<script setup lang="ts">
defineProps<{
  itemCount: number
  subtotal: string
  currency: string
}>()
</script>

<template>
  <section class="rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-[var(--shadow-card)]">
    <div class="flex items-center justify-between gap-4 text-sm text-[rgb(var(--muted))]">
      <span>{{ itemCount }} món</span>
      <span>Tạm tính</span>
    </div>
    <p
      data-cart-subtotal
      class="mt-2 text-right text-2xl font-black"
    >
      {{ formatMoney(subtotal, currency) }}
    </p>
    <p class="mt-2 text-xs leading-5 text-[rgb(var(--muted))]">
      Giá này là tạm tính trên thiết bị. Máy chủ sẽ kiểm tra lại giá và tình trạng món khi đặt đơn.
    </p>
  </section>
</template>
