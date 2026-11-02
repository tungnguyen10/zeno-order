<script setup lang="ts">
import type { FulfillmentType, OrderStatus } from '#shared/enums'
import { customerStatusLabel, orderProgressSteps } from '~/utils/order-labels'

const props = defineProps<{ status: OrderStatus, fulfillmentType: FulfillmentType }>()

const steps = computed(() => orderProgressSteps(props.fulfillmentType))
const currentIndex = computed(() => steps.value.indexOf(props.status))

function stateOf(index: number): 'done' | 'current' | 'todo' {
  if (props.status === 'COMPLETED' || index < currentIndex.value) return 'done'
  return index === currentIndex.value ? 'current' : 'todo'
}

const dot = {
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  current: 'bg-primary text-(--zeno-on-primary)',
  todo: 'bg-(--zeno-surface-inset) text-muted',
}
const icon = { done: 'i-lucide-check', current: 'i-lucide-loader', todo: 'i-lucide-circle' }
</script>

<template>
  <ol class="flex flex-col gap-1" aria-label="Tiến độ đơn hàng">
    <li
      v-for="(step, index) in steps"
      :key="step"
      class="flex min-h-11 items-center gap-3"
      :data-state="stateOf(index)"
      :aria-current="stateOf(index) === 'current' ? 'step' : undefined"
    >
      <span class="grid size-8 shrink-0 place-items-center rounded-full" :class="dot[stateOf(index)]">
        <UIcon :name="icon[stateOf(index)]" class="size-4" />
      </span>
      <span :class="stateOf(index) === 'todo' ? 'text-muted' : stateOf(index) === 'current' ? 'font-semibold text-default' : 'text-default'">
        {{ customerStatusLabel(step, fulfillmentType) }}
      </span>
    </li>
  </ol>
</template>
