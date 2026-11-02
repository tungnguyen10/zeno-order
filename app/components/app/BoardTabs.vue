<script setup lang="ts">
import { BOARD_TABS, TAB_LABELS, type BoardTab } from '#shared/order-flow'

const props = defineProps<{ counts: Record<BoardTab, number> }>()
const model = defineModel<BoardTab>({ required: true })

const visibleTabs = computed(() =>
  BOARD_TABS.filter(tab => tab !== 'awaiting_payment' || props.counts.awaiting_payment > 0 || model.value === 'awaiting_payment'),
)
</script>

<template>
  <div
    role="tablist"
    aria-label="Nhóm đơn hàng"
    class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0"
  >
    <button
      v-for="tab in visibleTabs"
      :key="tab"
      type="button"
      role="tab"
      :aria-selected="model === tab"
      :data-testid="`tab-${tab}`"
      class="flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-4 font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="model === tab
        ? 'border-primary bg-primary text-(--zeno-on-primary)'
        : 'border-default bg-(--zeno-surface) text-muted hover:bg-(--zeno-surface-hover)'"
      @click="model = tab"
    >
      {{ TAB_LABELS[tab] }}
      <span
        v-if="tab !== 'other' && counts[tab] > 0"
        class="min-w-6 rounded-full px-1.5 text-center text-[13px] font-semibold"
        :class="model === tab ? 'bg-white/25 text-(--zeno-on-primary)' : 'bg-primary/12 text-primary'"
      >{{ counts[tab] }}</span>
    </button>
  </div>
</template>
