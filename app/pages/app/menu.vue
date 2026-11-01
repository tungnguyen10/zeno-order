<script setup lang="ts">
import type { ProductDTO } from '#shared/types/catalog'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Thực đơn' })

const toast = useToast()
const { activeStore } = useActiveStore()
const { storeId, categories, products, status, refresh, addProduct, addCategory, patchProduct, replaceProduct } = useMenuAdmin()
const isOwner = computed(() => activeStore.value?.role === 'OWNER')
const editing = ref<ProductDTO | null>(null)
const editorOpen = ref(false)
const editorDirty = ref(false)
useUnsavedChangesGuard(computed(() => editorOpen.value && editorDirty.value))

watch(storeId, () => {
  editorOpen.value = false
  editing.value = null
  editorDirty.value = false
})

function openEditor(product: ProductDTO) {
  editing.value = product
  editorOpen.value = true
}

function onSaved(product: ProductDTO) {
  replaceProduct(product)
  if (editing.value?.id === product.id) editing.value = product
}

async function setAvailable(product: ProductDTO, value: boolean) {
  try {
    await patchProduct(product.id, { isAvailable: value })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Thực đơn" description="Thêm món nhanh: gõ tên, gõ giá, bấm Thêm món." />
    <ZAlert v-if="!isOwner" color="info" title="Chỉ chủ cửa hàng mới sửa được thực đơn." />
    <MenuQuickAdd v-if="isOwner" :store-id="storeId" :categories="categories" :add-product="addProduct" :add-category="addCategory" />

    <div v-if="status === 'pending' && products.length === 0" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải thực đơn">
      <USkeleton v-for="i in 3" :key="i" class="h-20 w-full rounded-md" />
    </div>
    <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được thực đơn">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">Thử lại</ZButton>
      </template>
    </ZAlert>
    <ZCard v-else-if="products.length === 0" variant="raised" padding="lg">
      <AppEmptyState icon="i-lucide-utensils-crossed" title="Chưa có món nào" description="Gõ tên và giá ở ô phía trên để thêm món đầu tiên." />
    </ZCard>
    <MenuGroupedList v-else :categories="categories" :products="products" :is-owner="isOwner" @toggle-availability="setAvailable" @edit="openEditor" />
    <MenuProductEditor
      v-if="isOwner && activeStore"
      v-model:open="editorOpen"
      v-model:dirty="editorDirty"
      :product="editing"
      :categories="categories"
      :store-id="activeStore.id"
      @saved="onSaved"
    />
  </div>
</template>
