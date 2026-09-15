<script setup lang="ts">
import type { StorefrontCatalog } from '../../../shared/types/catalog'

defineProps<{
  store: StorefrontCatalog['store']
}>()
</script>

<template>
  <header class="overflow-hidden bg-[rgb(var(--surface))]">
    <div
      v-if="store.coverPath"
      class="aspect-[16/7] w-full overflow-hidden bg-[rgb(var(--brand-soft))]"
    >
      <img
        :src="store.coverPath"
        :alt="`Ảnh bìa ${store.name}`"
        class="size-full object-cover"
      >
    </div>
    <div
      v-else
      class="h-24 bg-[linear-gradient(135deg,rgb(var(--brand)),rgb(var(--accent)))]"
      aria-hidden="true"
    />

    <div class="relative px-5 pb-5 sm:px-8">
      <div class="-mt-8 flex items-end gap-4">
        <img
          v-if="store.logoPath"
          :src="store.logoPath"
          :alt="`Logo ${store.name}`"
          class="size-16 rounded-2xl border-4 border-white bg-white object-cover shadow-sm"
        >
        <div
          v-else
          class="grid size-16 place-items-center rounded-2xl border-4 border-white bg-[rgb(var(--brand-soft))] text-2xl font-black text-[rgb(var(--brand))] shadow-sm"
          aria-hidden="true"
        >
          {{ store.name.slice(0, 1).toUpperCase() }}
        </div>
      </div>

      <div class="mt-4 space-y-2">
        <p class="text-xs font-bold uppercase tracking-[0.18em] text-[rgb(var(--brand))]">
          Đặt món trực tuyến
        </p>
        <h1 class="text-3xl font-black tracking-tight sm:text-4xl">
          {{ store.name }}
        </h1>
        <p
          v-if="store.description"
          class="max-w-2xl text-sm leading-6 text-[rgb(var(--muted))] sm:text-base"
        >
          {{ store.description }}
        </p>
      </div>
    </div>
  </header>
</template>
