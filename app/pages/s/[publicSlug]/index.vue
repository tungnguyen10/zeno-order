<script setup lang="ts">
import type { StorefrontAvailability } from '../../../../shared/types/availability'
import type { StorefrontCatalog } from '../../../../shared/types/catalog'
import type { NewCartItem } from '../../../../shared/types/cart'

const route = useRoute()
const publicSlug = String(route.params.publicSlug)
const [catalogResult, availabilityResult] = await Promise.all([
  useFetch<StorefrontCatalog>(
    `/api/storefront/${publicSlug}/catalog`,
    { key: `storefront-catalog:${publicSlug}` },
  ),
  useFetch<StorefrontAvailability>(
    `/api/storefront/${publicSlug}/availability`,
    { key: `storefront-availability:${publicSlug}` },
  ),
])

const catalog = catalogResult.data.value
const availability = availabilityResult.data.value
const catalogError = getStorefrontPageError(catalogResult.error.value, Boolean(catalog))
const availabilityError = getStorefrontPageError(availabilityResult.error.value, Boolean(availability))
const pageError = catalogError ?? availabilityError

if (pageError || !catalog || !availability) {
  throw createError(pageError ?? {
    statusCode: 500,
    statusMessage: 'Không thể tải thông tin cửa hàng.',
  })
}

const storeCurrency = catalog.store.currency
const productsById = new Map(catalog.products.map(product => [product.id, product]))
const sectionViews = catalog.sections
  .map(section => ({
    section,
    products: catalog.menuItems
      .filter(item => item.sectionId === section.id)
      .map(item => productsById.get(item.productId))
      .filter(product => product !== undefined),
  }))
  .filter(view => view.products.length > 0)
const visibleSections = sectionViews.map(view => view.section)
const availabilityByProduct = new Map(
  availability.products.map(product => [product.productId, product.isAvailable]),
)
const selectedProduct = ref<StorefrontCatalog['products'][number] | null>(null)
const cart = useCartStore()

onMounted(() => {
  cart.hydrate(publicSlug, storeCurrency)
})

const selectedOptionGroups = computed(() => {
  if (!selectedProduct.value) {
    return []
  }

  const linkedGroupIds = new Set(
    catalog.productOptionGroups
      .filter(link => link.productId === selectedProduct.value?.id)
      .map(link => link.optionGroupId),
  )
  return catalog.optionGroups.filter(group => linkedGroupIds.has(group.id))
})

function addConfiguredItem(item: NewCartItem) {
  cart.addItem(publicSlug, storeCurrency, item)
  selectedProduct.value = null
}

useSeoMeta({
  title: `${catalog.store.name} | Đặt món online`,
  description: catalog.store.description ?? `Đặt món trực tuyến tại ${catalog.store.name}.`,
})
</script>

<template>
  <main class="min-h-screen bg-[rgb(var(--background))] pb-16">
    <div
      v-if="catalog && availability"
      class="mx-auto max-w-5xl"
    >
      <StorefrontStoreHeader :store="catalog.store" />

      <div class="space-y-6 px-4 pt-4 sm:px-6">
        <StorefrontStoreStatus :availability="availability" />

        <StorefrontSectionNav
          v-if="visibleSections.length"
          :sections="visibleSections"
        />

        <div
          v-if="sectionViews.length"
          class="space-y-9"
        >
          <StorefrontProductSection
            v-for="view in sectionViews"
            :key="view.section.id"
            :section="view.section"
            :products="view.products"
            :currency="storeCurrency"
            :availability-by-product="availabilityByProduct"
            :ordering-enabled="availability.orderingEnabled"
            @select="selectedProduct = $event"
          />
        </div>

        <section
          v-else
          class="rounded-[var(--radius-card)] border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-5 py-12 text-center"
        >
          <h2 class="font-bold">
            Thực đơn đang được cập nhật
          </h2>
          <p class="mt-2 text-sm text-[rgb(var(--muted))]">
            Vui lòng quay lại sau để xem các món mới.
          </p>
        </section>
      </div>

      <StorefrontProductConfigurator
        v-if="selectedProduct"
        :open="true"
        :product="selectedProduct"
        :option-groups="selectedOptionGroups"
        :currency="storeCurrency"
        @close="selectedProduct = null"
        @add="addConfiguredItem"
      />

      <StorefrontCartBar
        :public-slug="publicSlug"
        :item-count="cart.itemCount(publicSlug)"
        :subtotal="cart.subtotal(publicSlug)"
        :currency="storeCurrency"
      />
    </div>
  </main>
</template>
