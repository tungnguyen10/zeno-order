<script setup lang="ts">
useHead({ title: 'ZENO Order' })
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-2xl font-semibold">ZENO Order</h1>
    <p class="text-muted">Đặt món nhanh cho quán trà sữa & cafe.</p>
    <UButton to="/login" size="lg">Đăng nhập chủ quán</UButton>
  </main>
</template>
