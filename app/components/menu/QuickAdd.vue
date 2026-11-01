<script setup lang="ts">
import { parseVndInput } from '#shared/money'
import { vndSchema } from '#shared/schemas/common'
import type { CategoryDTO, ProductDTO } from '#shared/types/catalog'

const props = defineProps<{
  storeId: string | undefined
  categories: CategoryDTO[]
  addProduct: (input: { name: string, basePriceVnd: number, categoryId: string | null }) => Promise<ProductDTO>
  addCategory: (name: string) => Promise<CategoryDTO>
}>()

const NO_CATEGORY = '__none'
const toast = useToast()
const form = reactive({ name: '', price: '', categoryId: NO_CATEGORY })
const errors = reactive({ name: '', price: '', category: '' })
const adding = shallowRef(false)
const categoryName = shallowRef('')
const addingCategory = shallowRef(false)
const nameField = useTemplateRef<{ $el: HTMLElement }>('nameField')
let formGeneration = 0

watch(() => props.storeId, () => {
  formGeneration++
  form.name = ''
  form.price = ''
  form.categoryId = NO_CATEGORY
  categoryName.value = ''
  errors.name = ''
  errors.price = ''
  errors.category = ''
  adding.value = false
  addingCategory.value = false
})

const categoryItems = computed(() => [
  { label: 'Không phân loại', value: NO_CATEGORY },
  ...props.categories.map(category => ({ label: category.name, value: category.id })),
])

async function submit() {
  if (adding.value) return
  const price = parseVndInput(form.price)
  errors.name = form.name.trim() ? '' : 'Nhập tên món'
  errors.price = price !== null && vndSchema.safeParse(price).success ? '' : 'Nhập giá hợp lệ'
  if (errors.name || errors.price || price === null) return
  adding.value = true
  const request = formGeneration
  try {
    const created = await props.addProduct({
      name: form.name.trim(), basePriceVnd: price,
      categoryId: form.categoryId === NO_CATEGORY ? null : form.categoryId,
    })
    if (request !== formGeneration) return
    toast.add({ color: 'success', title: `Đã thêm ${created.name}` })
    form.name = ''
    form.price = ''
    nameField.value?.$el.querySelector('input')?.focus()
  }
  catch (err) {
    if (request === formGeneration) toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    if (request === formGeneration) adding.value = false
  }
}

async function submitCategory() {
  if (addingCategory.value) return
  const name = categoryName.value.trim()
  errors.category = name ? '' : 'Nhập tên danh mục'
  if (!name) return
  addingCategory.value = true
  const request = formGeneration
  try {
    const created = await props.addCategory(name)
    if (request !== formGeneration) return
    form.categoryId = created.id
    categoryName.value = ''
    toast.add({ color: 'success', title: `Đã thêm danh mục ${created.name}` })
  }
  catch (err) {
    if (request === formGeneration) toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    if (request === formGeneration) addingCategory.value = false
  }
}
</script>

<template>
  <ZCard title="Thêm món nhanh" padding="lg">
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <ZFormField label="Tên món" name="name" :error="errors.name">
        <ZInput ref="nameField" v-model="form.name" size="lg" placeholder="Ví dụ: Trà sữa trân châu" autocomplete="off" />
      </ZFormField>
      <ZFormField label="Giá (đ)" name="price" :error="errors.price" help="Gõ 35000, 35.000 hoặc 35k đều được.">
        <ZInput v-model="form.price" size="lg" inputmode="numeric" placeholder="35k" autocomplete="off" />
      </ZFormField>
      <ZFormField v-if="categories.length > 0" label="Danh mục của món" name="category">
        <ZSelect v-model="form.categoryId" :items="categoryItems" size="lg" aria-label="Danh mục của món" />
      </ZFormField>
      <ZButton type="submit" size="lg" block icon="i-lucide-plus" :loading="adding">Thêm món</ZButton>
    </form>
  </ZCard>

  <ZCard title="Danh mục" description="Nhóm món để khách dễ tìm. Không bắt buộc." padding="lg">
    <form class="flex flex-col gap-3 sm:flex-row sm:items-end" novalidate @submit.prevent="submitCategory">
      <ZFormField label="Tên danh mục" name="categoryName" :error="errors.category" class="flex-1">
        <ZInput v-model="categoryName" size="lg" placeholder="Ví dụ: Trà sữa" autocomplete="off" />
      </ZFormField>
      <ZButton type="submit" variant="secondary" size="lg" :loading="addingCategory">Thêm danh mục</ZButton>
    </form>
  </ZCard>
</template>
