<script setup lang="ts">
import type { SepayIntegrationDto } from '#shared/types/payment'
import type { PaymentStep } from '~/utils/payment-readiness'

const props = defineProps<{
  integration: SepayIntegrationDto | null
  step: PaymentStep
  busy: string | null
}>()
const emit = defineEmits<{
  'connect': []
  'save-secret': [input: { hmacSecret: string, apiToken?: string }]
  'link': []
  'activate': []
  'refresh': []
}>()

const hmacSecret = shallowRef('')
const apiToken = shallowRef('')
const editing = shallowRef(false)

// Secrets must not linger in the DOM: clear the fields as soon as the server confirms a save.
watch(() => props.integration?.secretUpdatedAt, () => {
  hmacSecret.value = ''
  apiToken.value = ''
  editing.value = false
})

const accountReady = computed(() => props.step !== 'ACCOUNT' && props.step !== 'CONFIRM_QR')
const showSecretForm = computed(() => !!props.integration && (!props.integration.hasSecret || editing.value))

function saveSecret() {
  const secret = hmacSecret.value.trim()
  if (!secret || props.busy) return
  const token = apiToken.value.trim()
  emit('save-secret', token ? { hmacSecret: secret, apiToken: token } : { hmacSecret: secret })
}
</script>

<template>
  <ZCard title="Nhận tiền tự động (SePay)" description="SePay báo về khi khách chuyển khoản; đơn tự chuyển sang đã thanh toán." padding="lg">
    <ZAlert v-if="!accountReady" color="info" title="Hoàn tất tài khoản nhận tiền trước" description="Kiểm tra tài khoản ở trên, sau đó quay lại đây để kết nối SePay." />

    <div v-else-if="!integration" class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Bạn cần tài khoản SePay đã liên kết ngân hàng. Kết nối chỉ mất vài phút.
      </p>
      <ZButton size="lg" block icon="i-lucide-plug-zap" :loading="busy === 'connect'" @click="emit('connect')">
        Kết nối SePay
      </ZButton>
    </div>

    <div v-else class="flex flex-col gap-4">
      <ZAlert v-if="integration.environment === 'test'" color="warning" title="SePay Test mode" description="Chỉ dùng thử nghiệm. Chuyển sang kết nối Live để nhận tiền khách." />
      <div class="flex flex-wrap items-center gap-2">
        <ZBadge status="info">{{ integration.environment === 'live' ? 'Live · Tiền thật' : 'Test · Thử nghiệm' }}</ZBadge>
        <ZBadge :status="integration.status === 'ACTIVE' ? 'success' : 'info'">
          {{ integration.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đang thiết lập' }}
        </ZBadge>
        <ZBadge v-if="integration.hasSecret" status="success" icon="i-lucide-lock-keyhole">
          Đã lưu Secret Key
        </ZBadge>
      </div>

      <template v-if="showSecretForm">
        <ol class="flex list-decimal flex-col gap-2 ps-5 text-sm">
          <li>
            Trên <strong>my.sepay.vn → Cấu hình công ty → Cấu hình chung → Cấu trúc mã thanh toán</strong>: tiền tố <strong>ZO</strong>,
            độ dài hậu tố tối thiểu và tối đa đều <strong>8</strong>, loại ký tự <strong>Số và chữ</strong>.
          </li>
          <li>
            Trên <strong>Tích hợp → Webhooks → Thêm webhook</strong>: dán URL bên dưới, loại sự kiện <strong>Tiền vào</strong>,
            xác thực <strong>HMAC-SHA256</strong>.
          </li>
          <li>SePay chỉ hiện đầy đủ một lần: sao chép Secret Key và dán vào ô bên dưới ngay.</li>
        </ol>
        <AppCopyField :value="integration.webhookUrl" label="URL webhook" />
        <ZFormField label="Secret Key (HMAC-SHA256)" name="hmacSecret" required>
          <ZInput v-model="hmacSecret" type="password" size="lg" autocomplete="off" />
        </ZFormField>
        <ZFormField label="Token API đối soát (không bắt buộc)" name="apiToken" help="Dùng để đối soát giao dịch bị lỡ webhook.">
          <ZInput v-model="apiToken" type="password" size="lg" autocomplete="off" />
        </ZFormField>
        <ZButton size="lg" block :loading="busy === 'secret'" :disabled="hmacSecret.trim() === '' || busy !== null" @click="saveSecret">
          Lưu Secret
        </ZButton>
      </template>
      <ZButton v-else-if="integration.hasSecret" variant="ghost" class="self-start" @click="editing = true">
        Đổi Secret
      </ZButton>

      <ZAlert v-if="step === 'LINK_ACCOUNT'" color="info" title="Liên kết tài khoản với SePay">
        <template #actions>
          <ZButton size="sm" :loading="busy === 'link'" @click="emit('link')">
            Liên kết tài khoản
          </ZButton>
        </template>
      </ZAlert>

      <ZAlert
        v-if="step === 'WAIT_WEBHOOK'"
        color="info"
        title="Chờ giao dịch đầu tiên từ SePay"
        description="Chuyển khoản một khoản nhỏ vào tài khoản đã liên kết SePay (có thể quét mã QR kiểm tra 2.000đ ở trên) rồi bấm Tải lại."
      >
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="emit('refresh')">
            Tải lại
          </ZButton>
        </template>
      </ZAlert>

      <ZButton v-if="step === 'ACTIVATE' && integration.environment === 'live'" size="lg" block icon="i-lucide-badge-check" :loading="busy === 'activate'" @click="emit('activate')">
        Bật nhận chuyển khoản
      </ZButton>

      <ZAlert v-if="step === 'READY'" color="success" title="Đang nhận chuyển khoản tự động" description="Khách chọn VietQR sẽ thấy mã đúng ngân hàng, số tiền và nội dung." />
    </div>
  </ZCard>
</template>
