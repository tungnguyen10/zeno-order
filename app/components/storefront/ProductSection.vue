<script setup lang="ts">
import type { StorefrontCatalog } from '../../../shared/types/catalog'

defineProps<{
  section: StorefrontCatalog['sections'][number]
  products: StorefrontCatalog['products']
  currency: string
  availabilityByProduct: ReadonlyMap<string, boolean>
  orderingEnabled: boolean
}>()

defineEmits<{
  select: [product: StorefrontCatalog['products'][number]]
}>()
</script>

<template>
  <section
    :id="section.slug"
    data-storefront-section
    class="scroll-mt-20 space-y-4"
  >
    <div>
      <h2 class="text-xl font-black tracking-tight sm:text-2xl">
        {{ section.name }}
      </h2>
      <p
        v-if="section.description"
        class="mt-1 text-sm text-[rgb(var(--muted))]"
      >
        {{ section.description }}
      </p>
    </div>

    <div class="grid gap-3 md:grid-cols-2">
      <StorefrontProductCard
        v-for="product in products"
        :key="product.id"
        :product="product"
        :currency="currency"
        :is-available="availabilityByProduct.get(product.id) === true"
        :ordering-enabled="orderingEnabled"
        @select="$emit('select', product)"
      />
    </div>
  </section>
</template>
