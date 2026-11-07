<script setup lang="ts">
import { paymentTone } from '~/utils/order-view'
import { formatAge } from '~/utils/time-ago'
import type { OrderStatus } from '#shared/enums'
import { formatVnd } from '#shared/money'
import { FULFILLMENT_LABELS, PAYMENT_STATUS_LABELS, canMarkCashPaid, primaryAction } from '#shared/order-flow'
import type { BoardOrder } from '#shared/types/orders'

const props = defineProps<{ order: BoardOrder, busy?: boolean, now: number }>()
const emit = defineEmits<{ advance: [status: OrderStatus], markPaid: [], open: [] }>()

const MAX_LINES = 3
const action = computed(() => primaryAction(props.order))
const canPay = computed(() => canMarkCashPaid(props.order))
const where = computed(() => (props.order.fulfillmentType === 'DINE_IN' && props.order.tableName
  ? `${FULFILLMENT_LABELS.DINE_IN} · ${props.order.tableName}`
  : FULFILLMENT_LABELS[props.order.fulfillmentType]))
const lines = computed(() => props.order.items.slice(0, MAX_LINES))
const hidden = computed(() => Math.max(0, props.order.items.length - MAX_LINES))
const contact = computed(() => [props.order.customerName, props.order.customerPhone].filter(Boolean).join(' · '))
</script>

<template>
  <article :data-testid="`order-card-${order.publicCode}`">
    <ZCard variant="flat" padding="md">
      <div class="flex flex-col gap-3">
        <button
          type="button"
          class="flex min-h-11 w-full flex-col gap-2 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :aria-label="`Xem chi tiết đơn ${order.publicCode}`"
          @click="emit('open')"
        >
          <span class="flex items-center justify-between gap-3">
            <span class="font-mono text-xl font-semibold text-default">{{ order.publicCode }}</span>
            <span class="flex items-center gap-2">
              <ZBadge v-if="order.latePayment" status="warning" size="sm">Chuyển muộn</ZBadge>
              <ZBadge :status="paymentTone(order.paymentStatus)" size="sm">{{ PAYMENT_STATUS_LABELS[order.paymentStatus] }}</ZBadge>
            </span>
          </span>
          <span class="flex items-center justify-between gap-3 text-sm text-muted">
            <span class="font-medium text-default">{{ where }}</span>
            <span>{{ formatAge(order.createdAt, now) }}</span>
          </span>
          <span v-if="contact" class="block text-sm text-muted">{{ contact }}</span>
          <span class="flex flex-col gap-1">
            <span v-for="item in lines" :key="item.id" class="block text-base text-default">
              <span class="font-semibold">{{ item.qty }}×</span> {{ item.name }}
              <span v-if="item.options.length" class="block text-[13px] text-muted">{{ item.options.join(', ') }}</span>
            </span>
            <span v-if="hidden > 0" class="block text-sm text-muted">+{{ hidden }} món nữa</span>
          </span>
          <span v-if="order.notes" class="block rounded-md bg-(--zeno-surface-inset) px-3 py-2 text-sm text-default">Ghi chú: {{ order.notes }}</span>
          <span class="block text-right font-mono text-lg font-semibold text-default">{{ formatVnd(order.totalVnd) }}</span>
        </button>

        <div v-if="action || canPay" class="flex flex-col gap-2">
          <ZButton
            v-if="action"
            size="lg"
            block
            :loading="busy"
            :disabled="busy"
            @click="emit('advance', action.nextStatus)"
          >
            {{ action.label }}
          </ZButton>
          <ZButton
            v-if="canPay"
            variant="secondary"
            size="lg"
            block
            icon="i-lucide-banknote"
            :disabled="busy"
            @click="emit('markPaid')"
          >
            Đã thu tiền mặt
          </ZButton>
        </div>
      </div>
    </ZCard>
  </article>
</template>
