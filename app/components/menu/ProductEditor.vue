<script setup lang="ts">
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_TYPES } from '#shared/catalog-limits'
import { parseVndInput } from '#shared/money'
import { buildOptionsPayload, toEditableGroups, type EditableGroup } from '#shared/option-presets'
import { vndSchema } from '#shared/schemas/common'
import type { CategoryDTO, OptionGroupDTO, ProductDTO } from '#shared/types/catalog'

const NO_CATEGORY = '__none'

const open = defineModel<boolean>('open', { default: false })
const dirty = defineModel<boolean>('dirty', { default: false })
const props = defineProps<{ product: ProductDTO | null, categories: CategoryDTO[], storeId: string }>()
const emit = defineEmits<{ saved: [product: ProductDTO] }>()

const api = useApi()
const toast = useToast()

const draft = reactive({ name: '', price: '', description: '', categoryId: NO_CATEGORY })
const groups = ref<EditableGroup[]>([])
const imageUrl = ref<string | null>(null)
const initialOptionsJson = ref('')
const initialDraftJson = ref('')
const error = ref('')
const imageError = ref('')
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
let session = 0

const draftJson = computed(() => JSON.stringify(draft))
const isDirty = computed(() => open.value && (draftJson.value !== initialDraftJson.value
  || optionsJson(groups.value) !== initialOptionsJson.value || uploading.value || saving.value))
watch(isDirty, value => { dirty.value = value }, { immediate: true, flush: 'sync' })

const sheetOpen = computed({
  get: () => open.value,
  set: (value: boolean) => {
    if (!value && (saving.value || uploading.value)) return
    if (!value && isDirty.value && !window.confirm('Bạn có thay đổi chưa lưu. Đóng chỉnh sửa món?')) return
    open.value = value
  },
})

const categoryItems = computed(() => [
  { label: 'Không phân loại', value: NO_CATEGORY },
  ...props.categories.map(category => ({ label: category.name, value: category.id })),
])

function optionsJson(source: EditableGroup[]): string {
  const built = buildOptionsPayload(source)
  return built.ok ? JSON.stringify(built.groups) : ''
}

watch(() => props.storeId, () => {
  session++
  open.value = false
  dirty.value = false
})

watch(
  [() => open.value, () => props.product?.id],
  ([isOpen]) => {
    const product = props.product
    if (!isOpen || !product) return
    session++
    draft.name = product.name
    draft.price = String(product.basePriceVnd)
    draft.description = product.description ?? ''
    draft.categoryId = product.categoryId ?? NO_CATEGORY
    groups.value = toEditableGroups(product.optionGroups, () => crypto.randomUUID())
    imageUrl.value = product.imageUrl
    imageError.value = ''
    initialOptionsJson.value = optionsJson(groups.value)
    initialDraftJson.value = draftJson.value
    error.value = ''
  },
  { immediate: true },
)

function addGroup() {
  groups.value.push({
    key: crypto.randomUUID(),
    name: '',
    preset: 'single-required',
    values: [{ key: crypto.randomUUID(), name: '', priceRaw: '', active: true }],
  })
}

function fail(message: string) {
  error.value = message
}

async function save() {
  const product = props.product
  if (!product || saving.value || uploading.value) return
  const requestSession = session
  const requestStoreId = props.storeId
  const current = () => session === requestSession && props.storeId === requestStoreId && props.product?.id === product.id
  const price = parseVndInput(draft.price)
  if (!draft.name.trim()) return fail('Nhập tên món')
  if (price === null || !vndSchema.safeParse(price).success) return fail('Nhập giá hợp lệ, ví dụ 35000 hoặc 35k')
  const options = buildOptionsPayload(groups.value)
  if (!options.ok) return fail(options.error)

  error.value = ''
  saving.value = true
  try {
    let latest = await api<ProductDTO>(`/api/stores/${requestStoreId}/products/${product.id}`, {
      method: 'PATCH',
      body: {
        name: draft.name.trim(),
        basePriceVnd: price,
        description: draft.description.trim() || null,
        categoryId: draft.categoryId === NO_CATEGORY ? null : draft.categoryId,
      },
    })
    if (!current()) return
    emit('saved', latest)
    initialDraftJson.value = draftJson.value
    if (JSON.stringify(options.groups) !== initialOptionsJson.value) {
      try {
        const replaced = await api<{ optionGroups: OptionGroupDTO[] }>(`/api/stores/${requestStoreId}/products/${product.id}/options`, {
          method: 'PUT', body: { groups: options.groups },
        })
        if (!current()) return
        latest = { ...latest, optionGroups: replaced.optionGroups }
        emit('saved', latest)
        initialOptionsJson.value = JSON.stringify(options.groups)
      }
      catch (err) {
        if (current()) error.value = `Thông tin món đã lưu, nhưng nhóm option chưa lưu. ${extractApiError(err).message}`
        return
      }
    }
    toast.add({ color: 'success', title: 'Đã lưu món' })
    open.value = false
  }
  catch (err) {
    if (current()) error.value = extractApiError(err).message
  }
  finally {
    saving.value = false
  }
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const product = props.product
  if (!file || !product || saving.value || uploading.value) return
  const requestSession = session
  const requestStoreId = props.storeId
  const current = () => session === requestSession && props.storeId === requestStoreId && props.product?.id === product.id
  imageError.value = ''
  if (!(PRODUCT_IMAGE_TYPES as readonly string[]).includes(file.type) || file.size === 0) {
    imageError.value = 'Chỉ nhận ảnh JPG, PNG hoặc WebP'
    return
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    imageError.value = 'Ảnh tối đa 2 MB'
    return
  }
  // The server re-checks the file signature, so a renamed text file still fails there.
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const result = await api<{ imageUrl: string }>(`/api/stores/${requestStoreId}/products/${product.id}/image`, { method: 'POST', body: form })
    if (!current()) return
    imageUrl.value = result.imageUrl
    emit('saved', { ...props.product!, imageUrl: result.imageUrl })
  }
  catch (err) {
    if (!current()) return
    const message = extractApiError(err).message
    imageError.value = message.includes('Loại file') ? 'Chỉ nhận ảnh JPG, PNG hoặc WebP' : message
  }
  finally {
    uploading.value = false
  }
}
</script>

<template>
  <ZSheet v-model:open="sheetOpen" :title="product ? `Sửa ${product.name}` : 'Sửa món'" description="Chỉnh thông tin, ảnh và các nhóm option của món.">
    <form id="product-editor" class="flex flex-col gap-4" novalidate @submit.prevent="save">
      <ZAlert v-if="error" color="error" :title="error" />

      <div class="flex items-center gap-3">
        <img v-if="imageUrl" :src="imageUrl" alt="Ảnh món" width="80" height="80" class="size-20 shrink-0 rounded-md object-cover">
        <div class="flex flex-col gap-1">
          <ZButton variant="secondary" icon="i-lucide-image-plus" :loading="uploading" :disabled="saving" @click="fileInput?.click()">
            {{ imageUrl ? 'Đổi ảnh' : 'Thêm ảnh' }}
          </ZButton>
          <p class="text-[13px] text-muted">
            JPG, PNG hoặc WebP, tối đa 2 MB.
          </p>
        </div>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onFile">
      </div>
      <ZAlert v-if="imageError" color="error" :title="imageError" />

      <ZFormField label="Tên món">
        <ZInput v-model="draft.name" autocomplete="off" />
      </ZFormField>
      <ZFormField label="Giá (đ)" help="Gõ 35000, 35.000 hoặc 35k đều được.">
        <ZInput v-model="draft.price" inputmode="numeric" autocomplete="off" />
      </ZFormField>
      <ZFormField label="Mô tả ngắn">
        <ZInput v-model="draft.description" autocomplete="off" placeholder="Không bắt buộc" />
      </ZFormField>
      <ZFormField v-if="categories.length > 0" label="Danh mục">
        <ZSelect v-model="draft.categoryId" :items="categoryItems" aria-label="Danh mục" />
      </ZFormField>

      <section class="flex flex-col gap-3">
        <h3 class="text-h3 text-default">
          Nhóm option
        </h3>
        <MenuOptionGroupEditor
          v-for="(group, index) in groups"
          :key="group.key"
          :model-value="group"
          @update:model-value="groups[index] = $event"
          @remove="groups.splice(index, 1)"
        />
        <ZButton variant="secondary" icon="i-lucide-plus" @click="addGroup">
          Thêm nhóm option
        </ZButton>
      </section>
    </form>

    <template #footer>
      <ZButton type="submit" form="product-editor" size="lg" block :loading="saving" :disabled="uploading">
        Lưu món
      </ZButton>
    </template>
  </ZSheet>
</template>
