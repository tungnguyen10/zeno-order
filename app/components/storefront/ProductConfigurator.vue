<script setup lang="ts">
import type { StorefrontCatalog } from '../../../shared/types/catalog'
import type { NewCartItem } from '../../../shared/types/cart'
import { calculateLineTotal } from '../../domain/cart'
import {
  createDefaultSelections,
  type ProductSelections,
  validateProductConfiguration,
} from '../../domain/product-configuration'

const props = defineProps<{
  open: boolean
  product: StorefrontCatalog['products'][number]
  optionGroups: StorefrontCatalog['optionGroups']
  currency: string
}>()

const emit = defineEmits<{
  close: []
  add: [item: NewCartItem]
}>()

const selections = ref<ProductSelections>({})
const quantity = ref(1)
const note = ref('')
const errors = ref<Record<string, string>>({})

function reset() {
  selections.value = createDefaultSelections(props.optionGroups)
  quantity.value = 1
  note.value = ''
  errors.value = {}
}

watch(
  [() => props.open, () => props.product.id, () => props.optionGroups],
  ([open]) => {
    if (open) {
      reset()
    }
  },
  { immediate: true },
)

function toggleMultiple(groupId: string, valueId: string, checked: boolean) {
  const selected = selections.value[groupId] ?? []
  selections.value[groupId] = checked
    ? [...selected, valueId]
    : selected.filter(id => id !== valueId)
}

function handleMultipleChange(groupId: string, valueId: string, event: Event) {
  toggleMultiple(groupId, valueId, (event.target as HTMLInputElement).checked)
}

const selectedOptions = computed(() => props.optionGroups.flatMap(group => {
  const selectedIds = new Set(selections.value[group.id] ?? [])
  return group.values
    .filter(value => selectedIds.has(value.id))
    .map(value => ({
      optionGroupId: group.id,
      optionGroupName: group.name,
      optionValueId: value.id,
      optionValueName: value.name,
      priceAdjustment: value.priceAdjustment,
    }))
}))

const previewTotal = computed(() => {
  try {
    return calculateLineTotal({
      basePrice: props.product.basePrice,
      options: selectedOptions.value,
      quantity: quantity.value,
    })
  }
  catch {
    return props.product.basePrice
  }
})

function submit() {
  const validation = validateProductConfiguration(
    props.optionGroups,
    selections.value,
    quantity.value,
    note.value,
  )
  errors.value = validation.errors

  if (!validation.valid) {
    return
  }

  emit('add', {
    productId: props.product.id,
    productName: props.product.name,
    basePrice: props.product.basePrice,
    options: selectedOptions.value,
    quantity: quantity.value,
    note: note.value.trim(),
  })
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-6"
    @click.self="emit('close')"
  >
      <section
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`configure-${product.id}`"
        class="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[rgb(var(--surface))] shadow-2xl sm:max-w-lg sm:rounded-3xl"
      >
        <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-5 py-4">
          <div>
            <p class="text-xs font-bold uppercase tracking-[0.16em] text-[rgb(var(--brand))]">
              Tùy chọn món
            </p>
            <h2
              :id="`configure-${product.id}`"
              class="mt-1 text-xl font-black"
            >
              {{ product.name }}
            </h2>
          </div>
          <button
            type="button"
            class="grid size-10 shrink-0 place-items-center rounded-full bg-[rgb(var(--background))] text-xl"
            aria-label="Đóng"
            @click="emit('close')"
          >
            ×
          </button>
        </div>

        <form
          class="space-y-6 p-5"
          @submit.prevent="submit"
        >
          <p
            v-if="product.description"
            class="text-sm leading-6 text-[rgb(var(--muted))]"
          >
            {{ product.description }}
          </p>

          <fieldset
            v-for="group in optionGroups"
            :key="group.id"
            class="space-y-3"
          >
            <legend class="flex w-full items-center justify-between gap-3 font-extrabold">
              <span>{{ group.name }}</span>
              <span class="text-xs font-semibold text-[rgb(var(--muted))]">
                {{ group.required ? 'Bắt buộc' : `Chọn tối đa ${group.maxSelect}` }}
              </span>
            </legend>

            <label
              v-for="value in group.values"
              :key="value.id"
              class="flex cursor-pointer items-center gap-3 rounded-2xl border border-[rgb(var(--border))] px-4 py-3"
            >
              <input
                :type="group.selectionType === 'single' ? 'radio' : 'checkbox'"
                :name="group.id"
                :value="value.id"
                :checked="selections[group.id]?.includes(value.id)"
                class="size-4 accent-[rgb(var(--brand))]"
                @change="group.selectionType === 'single'
                  ? selections[group.id] = [value.id]
                  : handleMultipleChange(group.id, value.id, $event)"
              >
              <span class="flex-1 font-semibold">{{ value.name }}</span>
              <span
                v-if="value.priceAdjustment !== '0'"
                class="text-sm text-[rgb(var(--muted))]"
              >
                +{{ formatMoney(value.priceAdjustment, currency) }}
              </span>
            </label>

            <p
              v-if="errors[group.id]"
              class="text-sm font-semibold text-[rgb(var(--danger))]"
              role="alert"
            >
              {{ errors[group.id] }}
            </p>
          </fieldset>

          <div class="space-y-2">
            <label
              for="product-quantity"
              class="font-extrabold"
            >Số lượng</label>
            <input
              id="product-quantity"
              v-model.number="quantity"
              type="number"
              min="1"
              max="99"
              inputmode="numeric"
              class="w-24 rounded-xl border border-[rgb(var(--border))] px-3 py-2"
            >
            <p
              v-if="errors.quantity"
              role="alert"
              class="text-sm text-[rgb(var(--danger))]"
            >
              {{ errors.quantity }}
            </p>
          </div>

          <div class="space-y-2">
            <label
              for="product-note"
              class="font-extrabold"
            >Ghi chú cho món</label>
            <textarea
              id="product-note"
              v-model="note"
              maxlength="500"
              rows="3"
              placeholder="Ví dụ: ít đá"
              class="w-full resize-none rounded-2xl border border-[rgb(var(--border))] px-4 py-3"
            />
            <p
              v-if="errors.note"
              role="alert"
              class="text-sm text-[rgb(var(--danger))]"
            >
              {{ errors.note }}
            </p>
          </div>

          <button
            type="submit"
            class="sticky bottom-4 w-full rounded-2xl bg-[rgb(var(--brand))] px-5 py-4 font-black text-white shadow-lg"
          >
            Thêm vào giỏ · {{ formatMoney(previewTotal, currency) }}
          </button>
        </form>
      </section>
  </div>
</template>
