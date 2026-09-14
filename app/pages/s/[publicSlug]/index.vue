<script setup lang="ts">
import type { PublicStoreSummary } from '../../../../shared/types/storefront'

const route = useRoute()
const publicSlug = String(route.params.publicSlug)
const { data: store, error } = await useFetch<PublicStoreSummary>(
  `/api/storefront/${publicSlug}`,
  { key: `public-store:${publicSlug}` },
)

if (error.value || !store.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Không tìm thấy cửa hàng.',
  })
}

useSeoMeta({
  title: `${store.value.name} | Đặt món online`,
  description: store.value.description ?? `Đặt món trực tuyến tại ${store.value.name}.`,
})
</script>

<template>
  <main class="min-h-screen bg-[rgb(var(--background))] px-4 py-8 sm:px-6">
    <section class="mx-auto max-w-xl overflow-hidden rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] shadow-[var(--shadow-card)]">
      <div class="h-2 bg-[rgb(var(--brand))]" />

      <header class="space-y-4 px-5 py-6 sm:px-8">
        <img
          v-if="store.logoPath"
          :src="store.logoPath"
          :alt="`Logo ${store.name}`"
          class="size-16 rounded-2xl object-cover"
        >

        <div class="space-y-2">
          <p class="text-sm font-semibold uppercase tracking-[0.16em] text-[rgb(var(--brand))]">
            Đặt món trực tuyến
          </p>
          <h1 class="text-3xl font-bold tracking-tight">
            {{ store.name }}
          </h1>
          <p
            v-if="store.description"
            class="leading-7 text-[rgb(var(--muted))]"
          >
            {{ store.description }}
          </p>
        </div>
      </header>

      <section class="border-t border-[rgb(var(--border))] px-5 py-10 text-center sm:px-8">
        <p class="font-semibold">
          Thực đơn sắp được cập nhật
        </p>
        <p class="mt-2 text-sm text-[rgb(var(--muted))]">
          Catalog và tình trạng món sẽ được bổ sung trong lát cắt R2.
        </p>
      </section>
    </section>
  </main>
</template>

