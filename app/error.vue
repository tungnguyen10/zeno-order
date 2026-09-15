<script setup lang="ts">
const props = defineProps<{
  error: {
    statusCode: number
    statusMessage?: string
  }
}>()

const isNotFound = computed(() => props.error.statusCode === 404)
const title = computed(() => {
  if (isNotFound.value) {
    return props.error.statusMessage || 'Không tìm thấy cửa hàng.'
  }

  return 'Đã xảy ra lỗi.'
})
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-[rgb(var(--background))] px-4 py-10">
    <section class="w-full max-w-md rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-8 text-center shadow-[var(--shadow-card)]">
      <p class="text-sm font-semibold uppercase tracking-[0.16em] text-[rgb(var(--brand))]">
        Lỗi {{ error.statusCode }}
      </p>
      <h1 class="mt-3 text-2xl font-bold tracking-tight">
        {{ title }}
      </h1>
      <p class="mt-3 text-[rgb(var(--muted))]">
        {{ isNotFound ? 'Hãy kiểm tra lại đường dẫn cửa hàng.' : 'Vui lòng thử lại sau.' }}
      </p>
      <NuxtLink
        to="/"
        class="mt-6 inline-flex rounded-full bg-[rgb(var(--brand))] px-5 py-3 font-semibold text-white"
      >
        Về trang chủ
      </NuxtLink>
    </section>
  </main>
</template>
