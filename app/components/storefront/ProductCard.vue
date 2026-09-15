<script setup lang="ts">
import type { StorefrontCatalog } from '../../../shared/types/catalog'

defineProps<{
  product: StorefrontCatalog['products'][number]
  currency: string
  isAvailable: boolean
  orderingEnabled: boolean
}>()

defineEmits<{
  select: []
}>()
</script>

<template>
  <article
    data-product-card
    class="grid min-h-32 grid-cols-[1fr_7rem] gap-4 rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 shadow-[var(--shadow-card)]"
  >
    <div class="flex min-w-0 flex-col">
      <h3 class="font-extrabold leading-6">
        {{ product.name }}
      </h3>
      <p
        v-if="product.description"
        class="mt-1 line-clamp-2 text-sm leading-5 text-[rgb(var(--muted))]"
      >
        {{ product.description }}
      </p>
      <div class="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
        <p class="font-black text-[rgb(var(--brand))]">
          {{ formatMoney(product.basePrice, currency) }}
        </p>
        <span
          v-if="!isAvailable"
          class="rounded-full bg-[rgb(var(--danger-soft))] px-2.5 py-1 text-xs font-bold text-[rgb(var(--danger))]"
        >
          Tạm hết món
        </span>
      </div>
      <button
        type="button"
        class="mt-3 rounded-xl bg-[rgb(var(--brand))] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[rgb(var(--border))] disabled:text-[rgb(var(--muted))]"
        :disabled="!isAvailable || !orderingEnabled"
        @click="$emit('select')"
      >
        {{ orderingEnabled ? 'Chọn món' : 'Cửa hàng đang đóng' }}
      </button>
    </div>

    <div class="aspect-square overflow-hidden rounded-2xl bg-[rgb(var(--brand-soft))]">
      <img
        v-if="product.imagePath"
        :src="product.imagePath"
        :alt="product.name"
        loading="lazy"
        class="size-full object-cover"
      >
      <div
        v-else
        class="grid size-full place-items-center text-3xl"
        aria-hidden="true"
      >
        🍽️
      </div>
    </div>
  </article>
</template>
