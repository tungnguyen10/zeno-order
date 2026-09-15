<script setup lang="ts">
useSeoMeta({
  title: 'Zeno Order',
  description: 'Nền tảng đặt món trực tuyến cho cửa hàng địa phương.',
})
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-[rgb(var(--background))] px-4 py-10">
    <section class="w-full max-w-xl rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-8 shadow-[var(--shadow-card)]">
      <p class="text-sm font-semibold uppercase tracking-[0.16em] text-[rgb(var(--brand))]">
        Zeno Order
      </p>
      <h1 class="mt-3 text-3xl font-bold tracking-tight">
        Đặt món trực tuyến
      </h1>
      <p class="mt-3 leading-7 text-[rgb(var(--muted))]">
        Mở đường dẫn do cửa hàng chia sẻ để xem thông tin và thực đơn.
      </p>
    </section>
  </main>
</template>
