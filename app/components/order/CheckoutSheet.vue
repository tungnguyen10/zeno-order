<script setup lang="ts">
import type { Form, FormError } from '@nuxt/ui'
import type { FulfillmentType, PaymentMethod } from '#shared/enums'
import { formatVnd } from '#shared/money'
import { CHECKOUT_LIMITS, checkoutInputSchema } from '#shared/schemas/checkout'
import type { CartStaleDetails, CreateOrderResponse } from '#shared/types/order'
import { buildCheckoutPayload, checkoutFingerprint, type CheckoutForm } from '~/utils/checkout-body'
import { uuidv4 } from '~/utils/uuid'

interface Zone { id: string, name: string, feeVnd: number }
interface Notice { color: 'error' | 'warning', title: string, description?: string }

const props = defineProps<{
  slug: string
  storeName: string
  acceptingOrders: boolean
  bankQrEnabled?: boolean
  dineInEnabled: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
  deliveryZones: Zone[]
  tableToken: string | null
  tableLabel: string | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ refresh: [] }>()

const cart = useCart(props.slug)
const recent = useRecentOrders()
const formRef = useTemplateRef<Form<CheckoutForm>>('formRef')

const form = reactive<CheckoutForm>({ customer: { name: '', phone: '', address: '' }, deliveryZoneId: null, note: '' })
const mode = ref<FulfillmentType>('PICKUP')
const submitting = ref(false)
const paymentMethod = shallowRef<PaymentMethod>('PAY_ON_RECEIPT')
const notice = ref<Notice | null>(null)

const atTable = computed(() => props.dineInEnabled && !!props.tableToken && !!props.tableLabel)
const modes = computed<{ value: FulfillmentType, label: string }[]>(() => {
  if (atTable.value) return [{ value: 'DINE_IN', label: `Tại bàn · ${props.tableLabel}` }]
  return [
    ...(props.pickupEnabled ? [{ value: 'PICKUP' as const, label: 'Mang đi' }] : []),
    ...(props.deliveryEnabled ? [{ value: 'DELIVERY' as const, label: 'Giao hàng' }] : []),
  ]
})

const zone = computed(() => props.deliveryZones.find(item => item.id === form.deliveryZoneId) ?? null)
const zoneItems = computed(() => props.deliveryZones.map(item => ({ label: `${item.name} · ${formatVnd(item.feeVnd)}`, value: item.id })))
const deliveryFeeVnd = computed(() => (mode.value === 'DELIVERY' ? (zone.value?.feeVnd ?? 0) : 0))
const totalVnd = computed(() => cart.subtotalVnd.value + deliveryFeeVnd.value)
const canPayQr = computed(() => props.bankQrEnabled === true && totalVnd.value > 0)
watch(canPayQr, (available) => {
  if (!available) paymentMethod.value = 'PAY_ON_RECEIPT'
})
const paymentItems = computed(() => [
  { value: 'PAY_ON_RECEIPT' as const, label: 'Trả tiền khi nhận món' },
  ...(canPayQr.value ? [{ value: 'BANK_QR' as const, label: 'Chuyển khoản (VietQR)' }] : []),
])
const canSubmit = computed(() => props.acceptingOrders && modes.value.length > 0 && cart.lines.value.length > 0 && !cart.hasStale.value)

function hydrateForm() {
  Object.assign(form.customer, cart.customer.value)
  form.note = cart.note.value
  const remembered = cart.deliveryZoneId.value
  form.deliveryZoneId = props.deliveryZones.some(item => item.id === remembered)
    ? remembered
    : (props.deliveryZones.length === 1 ? props.deliveryZones[0]!.id : null)
  const wanted = atTable.value ? 'DINE_IN' : cart.fulfillmentType.value
  mode.value = modes.value.find(item => item.value === wanted)?.value ?? modes.value[0]?.value ?? 'PICKUP'
}

watch(() => cart.ready.value, (ready) => {
  if (ready) hydrateForm()
}, { immediate: true })

watch(modes, () => {
  if (!modes.value.some(item => item.value === mode.value)) mode.value = modes.value[0]?.value ?? 'PICKUP'
})

watch(form, () => {
  if (!cart.ready.value) return
  cart.updateForm({ customer: { ...form.customer }, deliveryZoneId: form.deliveryZoneId, note: form.note })
}, { deep: true })

watch(mode, (value) => {
  if (cart.ready.value && value !== 'DINE_IN') cart.updateForm({ fulfillmentType: value })
})

const payload = () => buildCheckoutPayload({
  lines: cart.lines.value,
  form,
  fulfillmentType: mode.value,
  tableToken: props.tableToken,
  paymentMethod: paymentMethod.value,
  deliveryFeeVnd: deliveryFeeVnd.value,
})

const FORM_FIELDS = ['customer', 'deliveryZoneId', 'tableToken', 'note']

// Same schema as the server, so inline errors and server errors always agree.
function validate(): FormError[] {
  const result = checkoutInputSchema.safeParse({ ...payload(), idempotencyKey: uuidv4() })
  if (result.success) return []
  return result.error.issues
    .filter(issue => FORM_FIELDS.includes(String(issue.path[0])))
    .map(issue => ({ name: issue.path.join('.'), message: issue.message }))
}

async function submit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  notice.value = null
  const data = payload()
  // Same payload → same key, so a retry after a lost response returns the original order.
  const idempotencyKey = cart.ensureIdempotencyKey(checkoutFingerprint(data))
  try {
    const res = await $fetch<CreateOrderResponse>(`/api/public/stores/${encodeURIComponent(props.slug)}/orders`, {
      method: 'POST',
      body: { idempotencyKey, ...data },
    })
    recent.add({
      token: res.guestToken,
      publicCode: res.publicCode,
      storeSlug: props.slug,
      storeName: props.storeName,
      totalVnd: res.totalVnd,
      createdAt: new Date().toISOString(),
    })
    cart.clearAfterSuccess()
    open.value = false
    await navigateTo(`/o/${res.guestToken}`)
  }
  catch (err) {
    handleError(err)
  }
  finally {
    submitting.value = false
  }
}

function onStale(details: CartStaleDetails) {
  if (details.lines.length > 0) {
    cart.markStale(details.lines)
    notice.value = { color: 'warning', title: 'Một số món đã thay đổi', description: 'Xem các món được đánh dấu bên dưới rồi đặt lại.' }
  }
  else {
    notice.value = {
      color: 'warning',
      title: 'Phí giao hoặc tổng tiền đã thay đổi',
      description: details.totalVnd === null ? undefined : `Tổng mới: ${formatVnd(details.totalVnd)}. Bấm "Đặt món" để xác nhận.`,
    }
  }
  emit('refresh')
}

function handleError(err: unknown) {
  const error = extractApiError(err)
  if (!(err as { response?: unknown } | null)?.response) {
    notice.value = { color: 'warning', title: 'Mất kết nối', description: 'Bấm "Đặt món" lần nữa để thử lại. Đơn sẽ không bị đặt trùng.' }
    return
  }
  switch (error.code) {
    case 'CART_STALE':
      return onStale(error.details as CartStaleDetails)
    case 'VALIDATION_FAILED': {
      const issues = Array.isArray(error.details) ? (error.details as { path: string, message: string }[]) : []
      formRef.value?.setErrors(issues.map(issue => ({ name: issue.path, message: issue.message })))
      notice.value = { color: 'error', title: 'Vui lòng kiểm tra lại thông tin' }
      return
    }
    case 'STORE_CLOSED':
    case 'NOT_FOUND':
      notice.value = { color: 'warning', title: 'Quán đang tạm nghỉ', description: 'Giỏ hàng của bạn vẫn được giữ. Hãy thử lại khi quán mở cửa.' }
      return
    case 'PAYMENT_METHOD_UNAVAILABLE':
      paymentMethod.value = 'PAY_ON_RECEIPT'
      notice.value = { color: 'warning', title: 'Chuyển khoản đang tạm ngưng', description: 'Bạn có thể trả tiền khi nhận món. Giỏ hàng vẫn được giữ.' }
      return emit('refresh')
    case 'MODE_DISABLED':
      notice.value = { color: 'warning', title: 'Quán không nhận đơn theo hình thức này lúc này', description: 'Hãy thử hình thức khác.' }
      return emit('refresh')
    case 'INVALID_TABLE':
      notice.value = { color: 'error', title: 'Mã QR bàn không còn hiệu lực', description: 'Hãy quét lại mã QR trên bàn.' }
      return emit('refresh')
    case 'INVALID_ZONE':
      notice.value = { color: 'warning', title: 'Khu vực giao hàng không còn được hỗ trợ', description: 'Hãy chọn khu vực khác.' }
      return emit('refresh')
    case 'RATE_LIMITED':
      notice.value = { color: 'warning', title: 'Bạn đặt quá nhanh', description: 'Vui lòng thử lại sau ít phút.' }
      return
    default:
      notice.value = { color: 'error', title: 'Chưa gửi được đơn', description: 'Bấm "Đặt món" để thử lại. Đơn sẽ không bị đặt trùng.' }
  }
}
</script>

<template>
  <ZSheet v-model:open="open" title="Giỏ hàng của bạn" :description="`Đặt tại ${storeName}`">
    <template #default>
      <AppEmptyState
        v-if="cart.lines.value.length === 0"
        icon="i-lucide-shopping-bag"
        title="Giỏ hàng trống"
        description="Chọn vài món từ thực đơn rồi quay lại đây nhé."
      >
        <template #actions>
          <ZButton variant="secondary" block @click="open = false">
            Xem thực đơn
          </ZButton>
        </template>
      </AppEmptyState>

      <div v-else class="flex flex-col gap-5">
        <ZAlert v-if="!acceptingOrders" color="warning" title="Quán đang tạm nghỉ" description="Giỏ hàng được giữ lại, bạn đặt món khi quán mở cửa." />
        <ZAlert v-if="notice" :color="notice.color" :title="notice.title" :description="notice.description" />

        <ul class="flex flex-col gap-3">
          <li
            v-for="line in cart.lines.value"
            :key="line.lineId"
            class="flex flex-col gap-2 rounded-md p-3 ring-1"
            :class="line.stale ? 'ring-warning' : 'ring-default'"
            :data-stale="line.stale ?? undefined"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="break-words font-medium text-default">
                  {{ line.name }}
                </p>
                <p v-if="line.optionLabels.length" class="break-words text-sm text-muted">
                  {{ line.optionLabels.join(' · ') }}
                </p>
                <p v-if="line.note" class="break-words text-sm text-muted">
                  Ghi chú: {{ line.note }}
                </p>
              </div>
              <p class="shrink-0 font-mono text-sm text-default">
                {{ formatVnd(line.unitPriceVnd * line.quantity) }}
              </p>
            </div>

            <p v-if="line.stale === 'PRODUCT_UNAVAILABLE'" class="text-sm font-medium text-error">
              Món này đã hết, vui lòng xóa khỏi giỏ
            </p>
            <p v-else-if="line.stale === 'OPTION_INVALID'" class="text-sm font-medium text-error">
              Lựa chọn của món đã thay đổi, vui lòng xóa và chọn lại
            </p>
            <div v-else-if="line.stale === 'PRICE_CHANGED'" class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-medium text-error">
                Giá mới {{ formatVnd(line.currentUnitPriceVnd ?? 0) }}
              </p>
              <ZButton size="sm" variant="secondary" @click="cart.acceptPrice(line.lineId)">
                Cập nhật giá
              </ZButton>
            </div>

            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1">
                <ZButton
                  variant="secondary"
                  square
                  icon="i-lucide-minus"
                  :aria-label="`Giảm số lượng ${line.name}`"
                  @click="cart.setQuantity(line.lineId, line.quantity - 1)"
                />
                <span class="min-w-9 text-center font-mono" aria-live="polite">{{ line.quantity }}</span>
                <ZButton
                  variant="secondary"
                  square
                  icon="i-lucide-plus"
                  :disabled="line.quantity >= 50"
                  :aria-label="`Tăng số lượng ${line.name}`"
                  @click="cart.setQuantity(line.lineId, line.quantity + 1)"
                />
              </div>
              <ZButton variant="ghost" square icon="i-lucide-trash-2" :aria-label="`Xóa ${line.name}`" @click="cart.remove(line.lineId)" />
            </div>
          </li>
        </ul>

        <div v-if="modes.length === 0" class="rounded-md bg-(--zeno-surface-inset) p-3 text-sm text-muted">
          Quán chưa mở hình thức nhận món nào. Vui lòng quay lại sau.
        </div>

        <div v-else role="radiogroup" aria-label="Hình thức nhận món" class="grid gap-2" :class="modes.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
          <ZButton
            v-for="item in modes"
            :key="item.value"
            role="radio"
            :aria-checked="mode === item.value"
            :variant="mode === item.value ? 'primary' : 'secondary'"
            @click="mode = item.value"
          >
            {{ item.label }}
          </ZButton>
        </div>

        <UForm ref="formRef" :state="form" :validate="validate" class="flex flex-col gap-4" @submit="submit">
          <component :is="mode === 'DINE_IN' ? 'details' : 'div'" class="flex flex-col gap-4">
            <summary v-if="mode === 'DINE_IN'" class="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
              Thêm tên hoặc SĐT để quán gọi bạn (không bắt buộc)
            </summary>
            <ZFormField label="Tên của bạn" name="customer.name">
              <ZInput v-model="form.customer.name" size="lg" autocomplete="name" :maxlength="CHECKOUT_LIMITS.maxName" />
            </ZFormField>
            <ZFormField label="Số điện thoại" name="customer.phone">
              <ZInput v-model="form.customer.phone" size="lg" type="tel" inputmode="tel" autocomplete="tel" :maxlength="24" />
            </ZFormField>
          </component>

          <template v-if="mode === 'DELIVERY'">
            <ZFormField label="Khu vực giao" name="deliveryZoneId">
              <ZSelect
                aria-label="Khu vực giao"
                size="lg"
                placeholder="Chọn khu vực"
                :items="zoneItems"
                :model-value="form.deliveryZoneId ?? undefined"
                @update:model-value="form.deliveryZoneId = $event ?? null"
              />
            </ZFormField>
            <ZFormField label="Địa chỉ chi tiết" name="customer.address">
              <ZInput v-model="form.customer.address" size="lg" autocomplete="street-address" :maxlength="CHECKOUT_LIMITS.maxAddress" />
            </ZFormField>
          </template>

          <ZFormField label="Ghi chú cho quán" name="note" hint="Không bắt buộc">
            <ZInput v-model="form.note" size="lg" :maxlength="CHECKOUT_LIMITS.maxNote" />
          </ZFormField>
        </UForm>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 text-sm font-medium">Thanh toán</legend>
          <div role="radiogroup" aria-label="Hình thức thanh toán" class="grid gap-2">
            <ZButton
              v-for="item in paymentItems"
              :key="item.value"
              role="radio"
              :aria-checked="paymentMethod === item.value"
              :variant="paymentMethod === item.value ? 'primary' : 'secondary'"
              :disabled="submitting"
              @click="paymentMethod = item.value"
            >
              {{ item.label }}
            </ZButton>
          </div>
        </fieldset>

        <dl class="flex flex-col gap-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">
              Tạm tính
            </dt>
            <dd class="font-mono">
              {{ formatVnd(cart.subtotalVnd.value) }}
            </dd>
          </div>
          <div v-if="mode === 'DELIVERY'" class="flex justify-between">
            <dt class="text-muted">
              Phí giao
            </dt>
            <dd class="font-mono">
              {{ zone ? formatVnd(deliveryFeeVnd) : 'Chọn khu vực' }}
            </dd>
          </div>
          <div class="flex justify-between text-base font-semibold">
            <dt>Tổng cộng</dt>
            <dd class="font-mono" data-testid="checkout-total">
              {{ formatVnd(totalVnd) }}
            </dd>
          </div>
        </dl>
      </div>
    </template>

    <template v-if="cart.lines.value.length > 0" #footer>
      <div class="flex w-full flex-col gap-2">
        <ZButton size="lg" block :loading="submitting" :disabled="!canSubmit" @click="formRef?.submit()">
          Đặt món • {{ formatVnd(totalVnd) }}
        </ZButton>
        <p v-if="cart.hasStale.value" class="text-center text-sm text-muted">
          Xử lý các món được đánh dấu trước khi đặt.
        </p>
      </div>
    </template>
  </ZSheet>
</template>
