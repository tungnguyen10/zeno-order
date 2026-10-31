<script setup lang="ts">
definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Đơn hàng' })
</script>

<template>
  <section class="flex flex-col items-center gap-3 py-16 text-center">
    <UIcon name="i-lucide-receipt" class="size-10 text-muted" />
    <h1 class="text-lg font-semibold">Chưa có đơn hàng nào</h1>
    <p class="max-w-xs text-sm text-muted">Khi khách đặt món, đơn sẽ hiện ở đây.</p>
  </section>
</template>
