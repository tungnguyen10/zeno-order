<script setup lang="ts">
const props = defineProps<{ value: string, label: string }>()

const wrapper = useTemplateRef<HTMLElement>('wrapper')
const copied = ref(false)
const fallback = ref(false)
const announcement = ref('')
const canShare = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  canShare.value = typeof navigator.share === 'function'
})
onBeforeUnmount(() => clearTimeout(resetTimer))

function selectText() {
  wrapper.value?.querySelector('input')?.select()
}

async function copy() {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(props.value)
    fallback.value = false
    copied.value = true
    announcement.value = 'Đã sao chép'
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copied.value = false
      announcement.value = ''
    }, 2000)
  }
  catch {
    fallback.value = true
    selectText()
    announcement.value = 'Nhấn giữ để sao chép'
  }
}

async function share() {
  try {
    await navigator.share({ url: props.value })
  }
  catch {
    // The user dismissed the share sheet; nothing to recover.
  }
}
</script>

<template>
  <div ref="wrapper" class="flex flex-col gap-1.5">
    <ZFormField :label="label">
      <div class="flex gap-2">
        <ZInput :model-value="value" readonly class="min-w-0 flex-1 font-mono" @focus="selectText" />
        <ZButton
          variant="secondary"
          square
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          aria-label="Sao chép liên kết"
          @click="copy"
        />
        <ZButton
          v-if="canShare"
          variant="secondary"
          square
          icon="i-lucide-share-2"
          aria-label="Chia sẻ liên kết"
          @click="share"
        />
      </div>
    </ZFormField>
    <p v-if="fallback" class="text-[13px] text-muted">
      Nhấn giữ để sao chép
    </p>
    <p class="sr-only" aria-live="polite">
      {{ announcement }}
    </p>
  </div>
</template>
