<script setup lang="ts">
import { formatCountdown } from '~/utils/countdown'
import { formatVnd } from '#shared/money'
import type { PaymentQr } from '#shared/types/order'

const props = defineProps<{
  qr: PaymentQr | null
  totalVnd: number
  publicCode: string
  repaying?: boolean
}>()
const emit = defineEmits<{ repay: [], expired: [] }>()

const nowMs = shallowRef(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  ticker = setInterval(() => { nowMs.value = Date.now() }, 1000)
})
onBeforeUnmount(() => clearInterval(ticker))

const remaining = computed(() => (props.qr ? remainingSeconds(props.qr.expiresAt, nowMs.value) : 0))
const lapsed = computed(() => props.qr !== null && remaining.value <= 0)
const showQr = computed(() => props.qr !== null && !lapsed.value)
watch(lapsed, (value) => {
  if (value) emit('expired')
}, { immediate: true })

const downloadUrl = computed(() => (props.qr ? `${props.qr.imageUrl}&download=true` : ''))

const rows = computed(() => {
  const qr = props.qr
  if (!qr) return []
  return [
    { key: 'account', label: 'Số tài khoản', shown: qr.accountNumber, raw: qr.accountNumber, copyLabel: 'Sao chép số tài khoản' },
    { key: 'amount', label: 'Số tiền', shown: formatVnd(qr.amountVnd), raw: String(qr.amountVnd), copyLabel: 'Sao chép số tiền' },
    { key: 'content', label: 'Nội dung chuyển khoản', shown: qr.transferContent, raw: qr.transferContent, copyLabel: 'Sao chép nội dung chuyển khoản' },
  ]
})

const copiedKey = shallowRef<string | null>(null)
const copyFailed = shallowRef(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(resetTimer))

async function copy(key: string, text: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
    copyFailed.value = false
    copiedKey.value = key
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => { copiedKey.value = null }, 2000)
  }
  catch {
    copiedKey.value = null
    copyFailed.value = true
  }
}
const imageElement = useTemplateRef<HTMLImageElement>('qrImage')
const imageState = shallowRef<'loading' | 'loaded' | 'error'>('loading')
const imageRetry = shallowRef(0)
watch(() => props.qr?.imageUrl, () => {
  imageState.value = 'loading'
  imageRetry.value = 0
}, { flush: 'sync' })

function onImageState(event: Event, state: 'loaded' | 'error') {
  // A replaced image may finish its old request after the next QR has loaded.
  if (event.currentTarget === imageElement.value) imageState.value = state
}

function retryImage() {
  imageState.value = 'loading'
  imageRetry.value++
}

</script>

<template>
  <ZCard padding="lg" data-testid="payment-panel">
    <div v-if="showQr && qr" class="flex flex-col gap-4">
      <div class="text-center">
        <h2 class="text-lg font-semibold">
          Chuyển khoản để hoàn tất đơn #{{ publicCode }}
        </h2>
        <p class="mt-1 text-2xl font-semibold tabular-nums">
          {{ formatVnd(qr.amountVnd) }}
        </p>
        <p class="mt-1 text-sm text-muted" data-testid="payment-countdown">
          Còn {{ formatCountdown(remaining) }} để thanh toán
        </p>
      </div>

      <div
        class="relative mx-auto size-[240px] shrink-0 rounded-md bg-(--zeno-surface-inset)"
        :aria-busy="imageState === 'loading'"
      >
        <img
          ref="qrImage"
          :key="`${qr.imageUrl}:${imageRetry}`"
          :src="qr.imageUrl"
          width="240"
          height="240"
          alt="Mã QR chuyển khoản"
          referrerpolicy="no-referrer"
          class="size-full rounded-md bg-white p-2"
          :class="imageState === 'loaded' ? 'opacity-100' : 'opacity-0'"
          @load="onImageState($event, 'loaded')"
          @error="onImageState($event, 'error')"
        >
        <div v-if="imageState === 'loading'" role="status" class="absolute inset-0 flex items-center justify-center gap-2 p-4 text-center text-sm text-muted">
          <span aria-hidden="true" class="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Đang tải mã QR…
        </div>
        <div v-else-if="imageState === 'error'" role="alert" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm">
          <p class="font-medium">Chưa tải được mã QR</p>
          <p class="text-muted">Kiểm tra kết nối rồi thử lại.</p>
          <ZButton variant="secondary" icon="i-lucide-refresh-cw" @click="retryImage">
            Thử tải lại QR
          </ZButton>
        </div>
      </div>

      <ZButton variant="secondary" icon="i-lucide-download" :to="downloadUrl" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="self-center">
        Lưu ảnh QR
      </ZButton>

      <p class="text-center text-sm text-muted">
        {{ qr.bankName }} · {{ qr.accountHolder }}
      </p>

      <dl class="flex flex-col gap-2">
        <div v-for="row in rows" :key="row.key" class="flex items-center gap-3 rounded-md bg-(--zeno-surface-inset) px-3 py-2">
          <div class="min-w-0 flex-1">
            <dt class="text-[13px] text-muted">
              {{ row.label }}
            </dt>
            <dd class="break-all font-mono text-base font-medium" :data-testid="`payment-${row.key}`">
              {{ row.shown }}
            </dd>
          </div>
          <ZButton
            variant="secondary"
            square
            :icon="copiedKey === row.key ? 'i-lucide-check' : 'i-lucide-copy'"
            :aria-label="row.copyLabel"
            @click="copy(row.key, row.raw)"
          />
        </div>
      </dl>
      <p v-if="copyFailed" class="text-center text-[13px] text-muted">
        Nhấn giữ để sao chép
      </p>
      <p class="sr-only" aria-live="polite">
        {{ copiedKey ? 'Đã sao chép' : '' }}
      </p>

      <ZAlert
        color="info"
        title="Nhập đúng nội dung chuyển khoản"
        description="Đơn được xác nhận tự động nhờ mã trong nội dung. Sau khi chuyển khoản, trang này tự cập nhật."
      />
    </div>

    <div v-else class="flex flex-col gap-4">
      <ZAlert
        color="warning"
        title="Mã QR đã hết hạn"
        description="Nếu bạn đã chuyển khoản trước khi mã hết hạn, đừng chuyển lại: cửa hàng sẽ đối soát. Chưa chuyển thì hãy tạo mã mới."
      />
      <ZButton block size="lg" icon="i-lucide-qr-code" :loading="repaying" :disabled="repaying" @click="emit('repay')">
        Tạo mã mới
      </ZButton>
    </div>
  </ZCard>
</template>
