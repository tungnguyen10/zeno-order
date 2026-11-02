<script setup lang="ts">
import { formatVnd } from '#shared/money'
import type { PublicProduct } from '#shared/types/catalog'

defineProps<{ product: PublicProduct, canOrder: boolean }>()
defineEmits<{ add: [product: PublicProduct] }>()
</script>

<template>
  <li class="flex items-center gap-3 rounded-md bg-(--zeno-surface) p-3 ring-1 ring-default" :class="{ 'opacity-60': !product.isAvailable }">
    <img v-if="product.imageUrl" :src="product.imageUrl" alt="" width="80" height="80" loading="lazy" class="size-20 shrink-0 rounded-md bg-(--zeno-surface-inset) object-cover">
    <div class="min-w-0 flex-1">
      <p class="break-words font-medium text-default">{{ product.name }}</p>
      <p v-if="product.description" class="line-clamp-2 text-sm text-muted">{{ product.description }}</p>
      <p class="mt-1 flex flex-wrap items-center gap-2 font-mono text-sm text-default">
        {{ formatVnd(product.basePriceVnd) }}
        <ZBadge v-if="!product.isAvailable" status="neutral" size="sm">Hết hàng</ZBadge>
        <span v-else-if="product.optionGroups.length > 0" class="font-sans text-[13px] text-muted">Tuỳ chọn</span>
      </p>
    </div>
    <ZButton square icon="i-lucide-plus" :aria-label="`Thêm ${product.name}`" :disabled="!product.isAvailable || !canOrder" @click="$emit('add', product)" />
  </li>
</template>
