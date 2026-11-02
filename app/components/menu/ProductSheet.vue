<script setup lang="ts">
import { formatVnd } from '#shared/money'
import { defaultSelection, MAX_LINE_QUANTITY, priceLine, selectionDeltas, toggleSelection, toOptionRules, validateSelection } from '#shared/pricing'
import type { PublicOptionGroup, PublicProduct } from '#shared/types/catalog'
import { CHECKOUT_LIMITS } from '#shared/schemas/checkout'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ product: PublicProduct | null, canOrder: boolean }>()
const emit = defineEmits<{ add: [payload: { valueIds: string[], quantity: number, note: string }] }>()
const rules = computed(() => toOptionRules(props.product?.optionGroups ?? []))
const selected = ref<string[]>([])
const quantity = ref(1)
const note = ref('')

watch([() => open.value, () => props.product?.id], ([isOpen]) => {
  if (!isOpen) return
  selected.value = defaultSelection(rules.value)
  quantity.value = 1
  note.value = ''
}, { immediate: true })

const validation = computed(() => validateSelection(rules.value, selected.value))
const total = computed(() => props.product ? priceLine({
  basePriceVnd: props.product.basePriceVnd,
  deltasVnd: selectionDeltas(rules.value, selected.value),
  quantity: quantity.value,
}).lineTotalVnd : 0)
const problem = computed(() => {
  const result = validation.value
  if (result.ok || !result.groupId) return ''
  const group = props.product?.optionGroups.find(item => item.id === result.groupId)
  return group ? `Chọn ${group.name} để tiếp tục` : ''
})

function hint(group: PublicOptionGroup): string {
  const base = group.required ? 'Bắt buộc' : 'Tuỳ chọn'
  return group.maxSelect > 1 ? `${base} · chọn tối đa ${group.maxSelect}` : base
}

function onToggle(group: PublicOptionGroup, valueId: string, event: Event) {
  const rule = rules.value.find(item => item.id === group.id)
  if (!rule) return
  selected.value = toggleSelection(rule, selected.value, valueId)
  ;(event.target as HTMLInputElement).checked = selected.value.includes(valueId)
}

function confirm() {
  const result = validation.value
  if (!result.ok || !props.canOrder) return
  emit('add', { valueIds: result.valueIds, quantity: quantity.value, note: note.value.trim() })
}
</script>

<template>
  <ZSheet v-model:open="open" :title="product?.name ?? 'Chọn món'" :description="product?.description ?? undefined">
    <div v-if="product" class="flex flex-col gap-5">
      <fieldset v-for="group in product.optionGroups" :key="group.id" class="flex flex-col gap-2">
        <legend class="flex w-full items-baseline justify-between gap-2 pb-1">
          <span class="font-semibold text-default">{{ group.name }}</span><span class="text-sm text-muted">{{ hint(group) }}</span>
        </legend>
        <label v-for="value in group.values" :key="value.id" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 ring-1 ring-default has-[:checked]:bg-(--zeno-surface-inset) has-[:checked]:ring-2 has-[:checked]:ring-primary">
          <input :type="group.maxSelect === 1 ? 'radio' : 'checkbox'" :name="group.id" :value="value.id" :checked="selected.includes(value.id)" class="size-5 accent-(--ui-primary)" @change="onToggle(group, value.id, $event)">
          <span class="flex-1 text-default">{{ value.name }}</span>
          <span v-if="value.priceDeltaVnd > 0" class="font-mono text-sm text-muted">+{{ formatVnd(value.priceDeltaVnd) }}</span>
        </label>
      </fieldset>
      <ZFormField label="Ghi chú cho món" hint="Không bắt buộc">
        <textarea v-model="note" aria-label="Ghi chú cho món" :maxlength="CHECKOUT_LIMITS.maxNote" rows="2" class="min-h-12 w-full rounded-md bg-(--zeno-surface-inset) px-3 py-2 text-base text-default ring-1 ring-default focus-visible:outline-2 focus-visible:outline-primary" />
      </ZFormField>
      <div class="flex items-center justify-between gap-3">
        <span class="font-semibold text-default">Số lượng</span>
        <div class="flex items-center gap-2">
          <ZButton variant="secondary" square icon="i-lucide-minus" aria-label="Giảm số lượng" :disabled="quantity <= 1" @click="quantity -= 1" />
          <span class="w-8 text-center font-mono text-lg" aria-live="polite">{{ quantity }}</span>
          <ZButton variant="secondary" square icon="i-lucide-plus" aria-label="Tăng số lượng" :disabled="quantity >= MAX_LINE_QUANTITY" @click="quantity += 1" />
        </div>
      </div>
    </div>
    <template #footer>
      <p v-if="problem" class="mb-2 text-sm text-error" role="status">{{ problem }}</p>
      <p v-else-if="!canOrder" class="mb-2 text-sm text-muted" role="status">Quán đang tạm nghỉ nên chưa thêm món được.</p>
      <ZButton size="lg" block :disabled="!validation.ok || !canOrder" @click="confirm">Thêm • {{ formatVnd(total) }}</ZButton>
    </template>
  </ZSheet>
</template>
