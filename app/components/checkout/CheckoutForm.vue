<script setup lang="ts">
import type { CheckoutDraft } from '../../../shared/types/order'

const props = defineProps<{ pending: boolean, siteKey: string }>()
const emit = defineEmits<{ submit: [draft: CheckoutDraft] }>()

const form = reactive({
  fulfillmentType: 'pickup' as 'delivery' | 'pickup',
  customerName: '',
  customerPhone: '',
  deliveryAddress: '',
  deliveryNote: '',
  customerNote: '',
  paymentMethod: 'cash' as 'cash' | 'bank_transfer',
})
const turnstileToken = shallowRef('')

watch(() => form.fulfillmentType, (type) => {
  if (type === 'pickup') {
    form.deliveryAddress = ''
    form.deliveryNote = ''
  }
})

function submit() {
  if (props.pending || !turnstileToken.value) return
  emit('submit', {
    fulfillmentType: form.fulfillmentType,
    customer: { name: form.customerName, phone: form.customerPhone },
    delivery: form.fulfillmentType === 'delivery'
      ? { address: form.deliveryAddress, note: form.deliveryNote }
      : null,
    customerNote: form.customerNote,
    paymentMethod: form.paymentMethod,
    turnstileToken: turnstileToken.value,
  })
}
</script>

<template>
  <form
    class="space-y-5"
    @submit.prevent="submit"
  >
    <fieldset class="rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-[var(--shadow-card)]">
      <legend class="px-1 text-lg font-black">
        Nhận món
      </legend>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <label class="cursor-pointer rounded-2xl border p-4 font-bold has-[:checked]:border-[rgb(var(--brand))] has-[:checked]:bg-[rgb(var(--brand-soft))]">
          <input v-model="form.fulfillmentType" class="mr-2" type="radio" value="pickup">
          Tự đến lấy
        </label>
        <label class="cursor-pointer rounded-2xl border p-4 font-bold has-[:checked]:border-[rgb(var(--brand))] has-[:checked]:bg-[rgb(var(--brand-soft))]">
          <input v-model="form.fulfillmentType" class="mr-2" type="radio" value="delivery">
          Giao tận nơi
        </label>
      </div>
      <div v-if="form.fulfillmentType === 'delivery'" class="mt-4 space-y-4">
        <label class="block text-sm font-bold">
          Địa chỉ giao hàng
          <textarea v-model="form.deliveryAddress" name="deliveryAddress" required maxlength="500" rows="3" class="mt-2 w-full rounded-2xl border border-[rgb(var(--border))] px-4 py-3 font-normal focus:border-[rgb(var(--brand))] focus:outline-none" />
        </label>
        <label class="block text-sm font-bold">
          Ghi chú giao hàng
          <input v-model="form.deliveryNote" name="deliveryNote" maxlength="500" class="mt-2 min-h-12 w-full rounded-2xl border border-[rgb(var(--border))] px-4 font-normal focus:border-[rgb(var(--brand))] focus:outline-none">
        </label>
      </div>
    </fieldset>

    <fieldset class="rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-[var(--shadow-card)]">
      <legend class="px-1 text-lg font-black">
        Liên hệ
      </legend>
      <div class="mt-3 space-y-4">
        <label class="block text-sm font-bold">Tên người nhận
          <input v-model="form.customerName" name="customerName" required maxlength="120" autocomplete="name" class="mt-2 min-h-12 w-full rounded-2xl border border-[rgb(var(--border))] px-4 font-normal focus:border-[rgb(var(--brand))] focus:outline-none">
        </label>
        <label class="block text-sm font-bold">Số điện thoại
          <input v-model="form.customerPhone" name="customerPhone" required minlength="5" maxlength="32" inputmode="tel" autocomplete="tel" class="mt-2 min-h-12 w-full rounded-2xl border border-[rgb(var(--border))] px-4 font-normal focus:border-[rgb(var(--brand))] focus:outline-none">
        </label>
        <label class="block text-sm font-bold">Ghi chú cho cửa hàng
          <textarea v-model="form.customerNote" name="customerNote" maxlength="500" rows="2" class="mt-2 w-full rounded-2xl border border-[rgb(var(--border))] px-4 py-3 font-normal focus:border-[rgb(var(--brand))] focus:outline-none" />
        </label>
      </div>
    </fieldset>

    <fieldset class="rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5 shadow-[var(--shadow-card)]">
      <legend class="px-1 text-lg font-black">
        Thanh toán
      </legend>
      <div class="mt-3 space-y-3">
        <label class="flex min-h-12 items-center rounded-2xl border p-3 font-bold has-[:checked]:border-[rgb(var(--brand))]">
          <input v-model="form.paymentMethod" class="mr-3" type="radio" value="cash">
          Tiền mặt khi nhận món
        </label>
        <label class="flex min-h-12 items-center rounded-2xl border p-3 font-bold has-[:checked]:border-[rgb(var(--brand))]">
          <input v-model="form.paymentMethod" class="mr-3" type="radio" value="bank_transfer">
          Chuyển khoản
        </label>
      </div>
    </fieldset>

    <CheckoutTurnstileWidget :site-key="siteKey" @verified="turnstileToken = $event" />

    <button
      type="submit"
      :disabled="pending || !turnstileToken"
      class="min-h-14 w-full rounded-2xl bg-[rgb(var(--brand))] px-5 text-lg font-black text-white shadow-lg shadow-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {{ pending ? 'Đang đặt đơn…' : 'Đặt đơn' }}
    </button>
  </form>
</template>
