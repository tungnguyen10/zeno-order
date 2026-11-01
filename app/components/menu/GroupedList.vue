<script setup lang="ts">
import { groupByCategory } from '#shared/menu-groups'
import { formatVnd } from '#shared/money'
import type { CategoryDTO, ProductDTO } from '#shared/types/catalog'

const props = defineProps<{ categories: CategoryDTO[], products: ProductDTO[], isOwner: boolean }>()
const emit = defineEmits<{ toggleAvailability: [product: ProductDTO, value: boolean] }>()
const sections = computed(() => groupByCategory(props.categories, props.products, { uncategorizedLabel: 'Chưa phân loại' }))
</script>

<template>
  <section v-for="section in sections" :key="section.id ?? 'none'" class="flex flex-col gap-3">
    <h2 class="text-h3 text-default">{{ section.name }}</h2>
    <ul class="flex flex-col gap-2">
      <li
        v-for="product in section.products"
        :key="product.id"
        class="flex flex-wrap items-center justify-between gap-3 rounded-md bg-(--zeno-surface) p-4 ring-1 ring-default"
      >
        <div class="flex min-w-0 items-center gap-3">
          <img v-if="product.imageUrl" :src="product.imageUrl" alt="" width="48" height="48" loading="lazy" class="size-12 shrink-0 rounded-md object-cover">
          <div class="min-w-0">
            <p class="break-words font-medium text-default">{{ product.name }}</p>
            <p class="font-mono text-sm text-muted">{{ formatVnd(product.basePriceVnd) }}</p>
          </div>
        </div>
        <ZSwitch
          :model-value="product.isAvailable"
          :disabled="!isOwner"
          label="Còn hàng"
          @update:model-value="emit('toggleAvailability', product, $event)"
        />
      </li>
    </ul>
  </section>
</template>
