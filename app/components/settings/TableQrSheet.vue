<script setup lang="ts">
import { downloadDataUrl, printQr, qrDataUrl, qrFilename } from '~/utils/qr'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ title: string, url: string, slug: string }>()

const dataUrl = shallowRef('')
const failed = shallowRef(false)

watch(
  [() => open.value, () => props.url],
  async ([isOpen, url], _previous, onCleanup) => {
    if (!isOpen || !url) return
    let cancelled = false
    onCleanup(() => { cancelled = true })
    failed.value = false
    dataUrl.value = ''
    try {
      const generated = await qrDataUrl(url)
      if (!cancelled) dataUrl.value = generated
    }
    catch {
      if (!cancelled) failed.value = true
    }
  },
  { immediate: true },
)
</script>

<template>
  <ZSheet v-model:open="open" :title="`Mã QR ${props.title}`" description="Mã này chỉ hiện một lần. Hãy tải về hoặc in ngay.">
    <div class="flex flex-col items-center gap-4">
      <ZAlert v-if="failed" color="error" title="Không tạo được ảnh QR, hãy thử lại" />
      <img v-else-if="dataUrl" :src="dataUrl" :alt="`Mã QR ${props.title}`" width="256" height="256" class="size-64 rounded-md bg-white p-2">
      <USkeleton v-else class="size-64 rounded-md" aria-label="Đang tạo mã QR" />
      <AppCopyField :value="props.url" label="Link bàn" class="w-full" />
    </div>
    <template #footer>
      <div class="flex gap-3">
        <ZButton class="flex-1" icon="i-lucide-download" :disabled="!dataUrl" @click="downloadDataUrl(dataUrl, qrFilename(props.slug, props.title))">
          Tải ảnh PNG
        </ZButton>
        <ZButton class="flex-1" variant="secondary" icon="i-lucide-printer" :disabled="!dataUrl" @click="printQr(dataUrl, props.title)">
          In
        </ZButton>
      </div>
    </template>
  </ZSheet>
</template>
