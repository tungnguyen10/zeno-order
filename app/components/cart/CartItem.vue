<script setup lang="ts">
import type { CartItem } from '../../../shared/types/cart'
import { calculateLineTotal, calculateUnitPrice } from '../../domain/cart'

const props = defineProps<{
  item: CartItem
  currency: string
}>()

defineEmits<{
  decrease: []
  increase: []
  remove: []
}>()

const unitPrice = computed(() => calculateUnitPrice(props.item))
const lineTotal = computed(() => calculateLineTotal(props.item))
</script>

<template>
  <article
    data-cart-item
    class="rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 shadow-[var(--shadow-card)]"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="font-black">
          {{ item.productName }}
        </h2>
        <p
          v-if="item.options.length"
          class="mt-1 text-sm text-[rgb(var(--muted))]"
        >
          {{ item.options.map(option => option.optionValueName).join(' · ') }}
        </p>
        <p
          v-if="item.note"
          class="mt-2 rounded-xl bg-[rgb(var(--background))] px-3 py-2 text-sm text-[rgb(var(--muted))]"
        >
          Ghi chú: {{ item.note }}
        </p>
      </div>
      <p class="shrink-0 font-black">
        {{ formatMoney(lineTotal, currency) }}
      </p>
    </div>

    <div class="mt-4 flex items-center justify-between gap-4 border-t border-[rgb(var(--border))] pt-4">
      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="item.quantity <= 1"
          :aria-label="`Giảm số lượng ${item.productName}`"
          class="grid size-10 place-items-center rounded-full border border-[rgb(var(--border))] text-lg font-black disabled:cursor-not-allowed disabled:opacity-40"
          @click="$emit('decrease')"
        >
          −
        </button>
        <output
          :aria-label="`Số lượng ${item.productName}`"
          class="min-w-8 text-center font-black"
        >{{ item.quantity }}</output>
        <button
          type="button"
          :disabled="item.quantity >= 99"
          :aria-label="`Tăng số lượng ${item.productName}`"
          class="grid size-10 place-items-center rounded-full border border-[rgb(var(--border))] text-lg font-black disabled:cursor-not-allowed disabled:opacity-40"
          @click="$emit('increase')"
        >
          +
        </button>
      </div>

      <div class="text-right">
        <p class="text-xs text-[rgb(var(--muted))]">
          {{ formatMoney(unitPrice, currency) }} / món
        </p>
        <button
          type="button"
          :aria-label="`Xóa ${item.productName} khỏi giỏ hàng`"
          class="mt-1 text-sm font-bold text-[rgb(var(--danger))] underline-offset-4 hover:underline"
          @click="$emit('remove')"
        >
          Xóa
        </button>
      </div>
    </div>
  </article>
</template>
