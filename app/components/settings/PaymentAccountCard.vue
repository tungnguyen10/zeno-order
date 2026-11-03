<script setup lang="ts">
import { findBank, VIETQR_BANKS } from '#shared/banks'
import type { PaymentAccountCheck, PaymentAccountDto } from '#shared/types/payment'
import type { PaymentAccountDraft } from '~/composables/usePaymentSetup'

const props = defineProps<{
  account: PaymentAccountDto | null
  check: PaymentAccountCheck | null
  busy: string | null
  fieldErrors: Record<string, string>
}>()
const emit = defineEmits<{ check: [draft: PaymentAccountDraft], confirm: [] }>()

const draft = reactive<PaymentAccountDraft>({ bankCode: '', accountNumber: '', accountHolder: '', vaNumber: null })
watch(() => props.account, (account) => {
  draft.bankCode = account?.bankCode ?? ''
  draft.accountNumber = account?.accountNumber ?? ''
  draft.accountHolder = account?.accountHolder ?? ''
  draft.vaNumber = account?.vaNumber ?? null
}, { immediate: true })

const bankItems = VIETQR_BANKS.map(bank => ({ label: `${bank.shortName} (${bank.code})`, value: bank.code }))
const bankCode = computed({
  get: () => draft.bankCode || undefined,
  set: (value) => { draft.bankCode = value ?? '' },
})
const bank = computed(() => findBank(draft.bankCode))
const vaRequired = computed(() => bank.value?.vaPolicy === 'REQUIRED')
const vaModel = computed({
  get: () => draft.vaNumber ?? '',
  set: (value) => { draft.vaNumber = value },
})

const errors = computed<Record<string, string>>(() => ({
  ...Object.fromEntries((props.check?.issues ?? []).map(issue => [issue.field, issue.message])),
  ...props.fieldErrors,
}))

const canSubmit = computed(() => draft.bankCode !== ''
  && draft.accountNumber.trim() !== ''
  && draft.accountHolder.trim() !== ''
  && (!vaRequired.value || (draft.vaNumber ?? '').trim() !== ''))

const dismissed = shallowRef(false)
watch(draft, () => { dismissed.value = true }, { flush: 'sync' })
watch(() => props.check, () => { dismissed.value = false })
const showPreview = computed(() => props.check?.ok === true && props.check.preview !== null && !dismissed.value)

function submit() {
  if (!canSubmit.value || props.busy) return
  dismissed.value = true
  emit('check', {
    bankCode: draft.bankCode,
    accountNumber: draft.accountNumber,
    accountHolder: draft.accountHolder,
    vaNumber: vaRequired.value ? draft.vaNumber : null,
  })
}
const imageElement = useTemplateRef<HTMLImageElement>('qrImage')
const imageState = shallowRef<'loading' | 'loaded' | 'error'>('loading')
const imageRetry = shallowRef(0)
watch(() => props.check?.preview?.imageUrl, () => {
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
  <ZCard title="Tài khoản nhận tiền" description="Tiền khách chuyển khoản sẽ vào tài khoản này." padding="lg">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <ZFormField label="Ngân hàng" name="bankCode" required>
        <div class="flex flex-col gap-1.5">
          <ZSelect v-model="bankCode" :items="bankItems" placeholder="Chọn ngân hàng" size="lg" aria-label="Ngân hàng" />
          <p v-if="errors.bankCode" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.bankCode }}
          </p>
        </div>
      </ZFormField>

      <ZAlert
        v-if="bank && vaRequired"
        color="warning"
        :title="`${bank.shortName} chỉ nhận tiền qua tài khoản ảo (VA)`"
        description="Nhập số tài khoản ảo bạn đã tạo trên SePay ở ô bên dưới, khách sẽ chuyển vào số này."
      />

      <ZFormField label="Số tài khoản" name="accountNumber" required>
        <div class="flex flex-col gap-1.5">
          <ZInput v-model="draft.accountNumber" size="lg" autocomplete="off" />
          <p v-if="errors.accountNumber" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.accountNumber }}
          </p>
        </div>
      </ZFormField>

      <ZFormField v-if="vaRequired" label="Số tài khoản ảo (VA)" name="vaNumber" required>
        <div class="flex flex-col gap-1.5">
          <ZInput v-model="vaModel" size="lg" autocomplete="off" />
          <p v-if="errors.vaNumber" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.vaNumber }}
          </p>
        </div>
      </ZFormField>

      <ZFormField label="Tên chủ tài khoản" name="accountHolder" required help="Viết hoa, không dấu, đúng như app ngân hàng hiển thị.">
        <div class="flex flex-col gap-1.5">
          <ZInput v-model="draft.accountHolder" size="lg" autocomplete="off" autocapitalize="characters" />
          <p v-if="errors.accountHolder" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.accountHolder }}
          </p>
        </div>
      </ZFormField>

      <ZAlert v-for="warning in check?.warnings ?? []" :key="warning" color="warning" :title="warning" />

      <ZButton type="submit" size="lg" block icon="i-lucide-scan-line" :loading="busy === 'check'" :disabled="!canSubmit || busy !== null">
        Kiểm tra
      </ZButton>
    </form>

    <div
      v-if="showPreview && check?.preview"
      class="mt-5 flex flex-col items-center gap-3 rounded-md bg-(--zeno-surface-inset) p-4"
      data-testid="payment-preview"
    >
      <div
        class="relative mx-auto size-[220px] shrink-0 rounded-md bg-(--zeno-surface-inset)"
        :aria-busy="imageState === 'loading'"
      >
        <img
          ref="qrImage"
          :key="`${check.preview.imageUrl}:${imageRetry}`"
          :src="check.preview.imageUrl"
          width="220"
          height="220"
          alt="Mã QR kiểm tra 2.000đ"
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
      <p class="text-center text-sm">
        Mở app ngân hàng và quét mã này (2.000đ). Tên người nhận phải là
        <strong>{{ check.preview.accountHolder }}</strong>.
      </p>
      <div class="flex w-full flex-col gap-2">
        <ZButton v-if="!account?.qrCheckedAt" block size="lg" :loading="busy === 'confirm'" :disabled="busy !== null" @click="emit('confirm')">
          Đúng tên, xác nhận
        </ZButton>
        <ZButton variant="ghost" block @click="dismissed = true">
          Sửa lại
        </ZButton>
      </div>
    </div>

    <ZAlert
      v-else-if="account?.qrCheckedAt"
      class="mt-5"
      color="success"
      title="Đã kiểm tra tài khoản"
      :description="`${account.bankName} · ${account.vaNumber ?? account.accountNumber} · ${account.accountHolder}`"
    />
  </ZCard>
</template>
