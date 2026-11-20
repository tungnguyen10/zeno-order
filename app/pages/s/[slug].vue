<script setup lang="ts">
import { newLineFromProduct } from '~/utils/cart-storage'
import { groupByCategory } from '#shared/menu-groups'
import { filterProducts, shouldShowSearch } from '#shared/menu-search'
import { tableTokenFromQuery } from '#shared/fulfillment-query'
import { describeOpenState, evaluateOpen } from '#shared/store-hours'
import type { PublicFulfillment, PublicMenu, PublicProduct } from '#shared/types/catalog'

const route = useRoute()
const toast = useToast()
const slug = computed(() => String(route.params.slug ?? '').toLowerCase())

const { data: menu, error, refresh } = await useFetch<PublicMenu>(
  () => `/api/public/stores/${encodeURIComponent(slug.value)}/menu`,
)
if (error.value?.statusCode === 404) throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })

const tableToken = computed(() => tableTokenFromQuery(route.query.t))
const { data: fulfillment, refresh: refreshFulfillment, clear: clearFulfillment } = await useFetch<PublicFulfillment | null>(
  () => `/api/public/stores/${encodeURIComponent(slug.value)}/fulfillment`,
  {
    query: computed(() => tableToken.value === undefined ? {} : { t: tableToken.value }),
    default: () => null,
    watch: false,
  },
)

watch([slug, tableToken], async () => {
  clearFulfillment()
  await refreshFulfillment()
})

useSeoMeta({
  title: () => menu.value?.store.name ?? 'Thực đơn',
  description: () => `Xem thực đơn và đặt món tại ${menu.value?.store.name ?? 'quán'}.`,
})

const cart = useCart(slug)
const checkoutOpen = ref(false)
const query = ref('')
const sheetOpen = ref(false)
const sheetProduct = ref<PublicProduct | null>(null)
// Re-evaluate opening hours on the device so the store flips open/closed at the exact boundary without a refetch.
const nowMs = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { nowMs.value = Date.now() }, 30_000) })
onBeforeUnmount(() => clearInterval(clock))

const openState = computed(() => {
  const store = menu.value?.store
  if (!store) return null
  const pausedUntil = store.pausedUntil ? new Date(store.pausedUntil) : null
  return evaluateOpen(store.openingHours, pausedUntil, new Date(nowMs.value))
})
const openNow = computed(() => openState.value?.open ?? true)
const canOrder = computed(() => (menu.value?.store.isAcceptingOrders ?? false) && openNow.value)
const closedByHours = computed(() => (menu.value?.store.isAcceptingOrders ?? false) && !openNow.value)
const closedHint = computed(() => (openState.value ? describeOpenState(openState.value, new Date(nowMs.value)) : null))
const tableLabel = computed(() => fulfillment.value?.table?.displayName ?? null)
const tableInvalid = computed(() => fulfillment.value?.tableError === 'INVALID_TABLE')
const showSearch = computed(() => shouldShowSearch(menu.value?.products.length ?? 0))
const visibleProducts = computed(() => menu.value ? filterProducts(menu.value.products, query.value) : [])
const sections = computed(() => menu.value ? groupByCategory(menu.value.categories, visibleProducts.value) : [])
const chipItems = computed(() => sections.value.map(section => ({
  id: section.id,
  name: section.name,
  imageUrl: menu.value?.categories.find(category => category.id === section.id)?.imageUrl ?? null,
})))
watch(slug, () => {
  sheetOpen.value = false
  checkoutOpen.value = false
  sheetProduct.value = null
})
const searching = computed(() => query.value.trim().length > 0)

function scrollToSection(id: string | null) {
  document.getElementById(`cat-${id ?? 'other'}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onAdd(product: PublicProduct) {
  if (!product.isAvailable || !canOrder.value) return
  if (product.optionGroups.length === 0) {
    cart.add(newLineFromProduct(product, { optionValueIds: [], quantity: 1 }))
    toast.add({ color: 'success', title: `Đã thêm ${product.name}` })
    return
  }
  sheetProduct.value = product
  sheetOpen.value = true
}

function onSheetAdd(payload: { valueIds: string[], quantity: number, note?: string }) {
  const product = sheetProduct.value
  if (!product) return
  cart.add(newLineFromProduct(product, { optionValueIds: payload.valueIds, quantity: payload.quantity, note: payload.note }))
  sheetOpen.value = false
  toast.add({ color: 'success', title: `Đã thêm ${product.name}` })
}
watch([() => menu.value?.products, () => cart.ready.value], ([products, ready]) => {
  if (products && ready) cart.reconcile(products)
}, { immediate: true })

async function refreshAll() {
  // Checkout errors describe current server state; bypass the public menu cache before reconciling.
  await Promise.all([
    $fetch<PublicMenu>(`/api/public/stores/${encodeURIComponent(slug.value)}/menu`, {
      query: { refresh: Date.now() },
      cache: 'no-store',
    }).then((fresh) => { menu.value = fresh }).catch(() => {
      toast.add({ color: 'warning', title: 'Chưa tải được thực đơn mới', description: 'Kiểm tra kết nối rồi thử lại.' })
    }),
    refreshFulfillment(),
  ])
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 pb-28 pt-[calc(1.25rem+env(safe-area-inset-top))] lg:max-w-5xl">
    <ZAlert v-if="error" color="error" title="Không tải được menu">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">Thử lại</ZButton>
      </template>
    </ZAlert>

    <template v-else-if="menu">
      <MenuStoreHeader :name="menu.store.name" :is-accepting-orders="menu.store.isAcceptingOrders" :modes="menu.modes" :table-label="tableLabel" />
      <ZAlert v-if="tableInvalid" color="warning" title="Mã QR không hợp lệ hoặc đã bị thu hồi" description="Bạn vẫn xem được menu nhưng chưa gắn với bàn nào. Hãy quét lại mã QR trên bàn hoặc hỏi nhân viên." />
      <ZAlert v-if="!menu.store.isAcceptingOrders" color="warning" title="Quán đang tạm nghỉ" description="Bạn vẫn xem được menu, nhưng chưa đặt món được lúc này." />
      <ZAlert v-else-if="closedByHours" color="warning" title="Quán đang đóng cửa" :description="closedHint ?? 'Bạn vẫn xem được menu, nhưng chưa đặt món được lúc này.'" />
      <OrderRecentOrders :slug="slug" :products="menu.products" :can-order="canOrder" @reordered="checkoutOpen = true" />
      <ZInput v-if="showSearch" v-model="query" type="search" icon="i-lucide-search" placeholder="Tìm món" aria-label="Tìm món" autocomplete="off" />

      <AppEmptyState v-if="menu.products.length === 0" icon="i-lucide-coffee" title="Menu đang được cập nhật" description="Quán đang thêm món. Bạn quay lại sau ít phút nhé." />
      <AppEmptyState v-else-if="searching && sections.length === 0" icon="i-lucide-search-x" title="Không tìm thấy món" description="Thử gõ từ khoá khác, không cần dấu." />

      <MenuCategoryChips v-if="chipItems.length > 1" :items="chipItems" @select="scrollToSection" />
      <section v-for="section in sections" :id="`cat-${section.id ?? 'other'}`" :key="section.id ?? 'other'" class="flex scroll-mt-16 flex-col gap-3">
        <h2 class="text-h3 text-default">{{ section.name }}</h2>
        <ul class="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3 lg:grid-cols-3">
          <MenuProductCard v-for="product in section.products" :key="product.id" :product="product" :can-order="canOrder" @add="onAdd" />
        </ul>
      </section>

      <MenuProductSheet v-model:open="sheetOpen" :product="sheetProduct" :can-order="canOrder" @add="onSheetAdd" />
      <OrderCartBar :key="`bar-${slug}`" :slug="slug" @open="checkoutOpen = true" />
      <OrderCheckoutSheet
        :key="`checkout-${slug}`"
        v-model:open="checkoutOpen"
        :slug="slug"
        :store-name="menu.store.name"
        :bank-qr-enabled="menu.bankQrEnabled ?? false"
        :accepting-orders="canOrder"
        :dine-in-enabled="fulfillment?.modes.dineIn ?? menu.modes.dineIn"
        :pickup-enabled="fulfillment?.modes.pickup ?? menu.modes.pickup"
        :delivery-enabled="fulfillment?.modes.delivery.available ?? menu.modes.delivery.available"
        :delivery-zones="fulfillment?.deliveryZones ?? []"
        :table-token="fulfillment?.table ? (tableToken ?? null) : null"
        :table-label="tableLabel"
        @refresh="refreshAll"
      />
    </template>
  </div>
</template>
