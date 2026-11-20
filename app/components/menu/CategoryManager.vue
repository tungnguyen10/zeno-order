<script setup lang="ts">
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_TYPES } from '#shared/catalog-limits'
import type { CategoryDTO } from '#shared/types/catalog'

const props = defineProps<{ storeId: string | undefined, categories: CategoryDTO[] }>()
const emit = defineEmits<{ saved: [category: CategoryDTO] }>()

const api = useApi()
const toast = useToast()

const uploadingId = ref<string | null>(null)
const errorId = ref<string | null>(null)
const errorMessage = ref('')
const fileInputs = new Map<string, HTMLInputElement>()

function setInput(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLInputElement) fileInputs.set(id, el)
  else fileInputs.delete(id)
}

function pick(categoryId: string) {
  if (uploadingId.value) return
  fileInputs.get(categoryId)?.click()
}

async function removeImage(category: CategoryDTO) {
  if (uploadingId.value) return
  const storeId = props.storeId
  if (!storeId) return
  errorId.value = null
  uploadingId.value = category.id
  try {
    await api(`/api/stores/${storeId}/categories/${category.id}/image`, { method: 'DELETE' })
    emit('saved', { ...category, imageUrl: null })
    toast.add({ color: 'success', title: `Đã xoá ảnh ${category.name}` })
  }
  catch (err) {
    errorId.value = category.id
    errorMessage.value = extractApiError(err).message
  }
  finally {
    uploadingId.value = null
  }
}

async function onFile(event: Event, category: CategoryDTO) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploadingId.value) return
  const storeId = props.storeId
  if (!storeId) return
  errorId.value = null
  errorMessage.value = ''
  if (!(PRODUCT_IMAGE_TYPES as readonly string[]).includes(file.type) || file.size === 0) {
    errorId.value = category.id
    errorMessage.value = 'Chỉ nhận ảnh JPG, PNG hoặc WebP'
    return
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    errorId.value = category.id
    errorMessage.value = 'Ảnh tối đa 2 MB'
    return
  }
  // The server re-checks the file signature, so a renamed text file still fails there.
  uploadingId.value = category.id
  try {
    const form = new FormData()
    form.append('file', file)
    const result = await api<{ imageUrl: string }>(`/api/stores/${storeId}/categories/${category.id}/image`, { method: 'POST', body: form })
    emit('saved', { ...category, imageUrl: result.imageUrl })
    toast.add({ color: 'success', title: `Đã cập nhật ảnh ${category.name}` })
  }
  catch (err) {
    errorId.value = category.id
    const message = extractApiError(err).message
    errorMessage.value = message.includes('Loại file') ? 'Chỉ nhận ảnh JPG, PNG hoặc WebP' : message
  }
  finally {
    uploadingId.value = null
  }
}
</script>

<template>
  <ZCard v-if="categories.length > 0" title="Ảnh danh mục" description="Ảnh đại diện hiển thị trên chip danh mục của trang khách." padding="lg">
    <ul class="flex flex-col gap-3">
      <li v-for="category in categories" :key="category.id" class="flex items-center gap-3">
        <img
          v-if="category.imageUrl"
          :src="category.imageUrl"
          alt=""
          width="48"
          height="48"
          class="size-12 shrink-0 rounded-md object-cover"
        >
        <div v-else class="flex size-12 shrink-0 items-center justify-center rounded-md bg-(--zeno-surface-inset) text-dimmed">
          <UIcon name="i-lucide-image" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium text-default">{{ category.name }}</p>
          <p v-if="errorId === category.id" class="text-[13px] text-error">{{ errorMessage }}</p>
          <p v-else class="text-[13px] text-muted">JPG, PNG hoặc WebP, tối đa 2 MB.</p>
        </div>
        <ZButton
          variant="secondary"
          size="sm"
          icon="i-lucide-image-plus"
          :loading="uploadingId === category.id"
          :disabled="uploadingId !== null && uploadingId !== category.id"
          @click="pick(category.id)"
        >
          {{ category.imageUrl ? 'Đổi ảnh' : 'Thêm ảnh' }}
        </ZButton>
        <ZButton
          v-if="category.imageUrl"
          variant="ghost"
          size="sm"
          square
          icon="i-lucide-trash-2"
          :aria-label="`Xoá ảnh ${category.name}`"
          :disabled="uploadingId !== null"
          @click="removeImage(category)"
        />
        <input
          :ref="el => setInput(category.id, el)"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="hidden"
          @change="onFile($event, category)"
        >
      </li>
    </ul>
  </ZCard>
</template>
