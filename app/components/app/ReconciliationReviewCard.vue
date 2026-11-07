<script setup lang="ts">
import { reasonStatus } from '~/utils/reconciliation'
import { formatDateTime } from '~/utils/order-view'
import { formatVnd } from '#shared/money'
import { RESOLUTIONS, RESOLUTION_LABEL, REVIEW_REASON_LABEL, type Resolution } from '#shared/payments'
import type { ReviewItem } from '#shared/types/reconciliation'

const props = defineProps<{ item: ReviewItem, busy?: boolean }>()
const emit = defineEmits<{
  assign: [orderId: string, acceptAmountDifference: boolean]
  resolve: [resolution: Resolution, note: string | undefined]
}>()

const quickResolutions = RESOLUTIONS.filter(r => r !== 'OTHER')
const isOpen = computed(() => props.item.status === 'REVIEW_REQUIRED')
const suggestion = computed(() => props.item.suggestedOrders[0] ?? null)
const comparison = computed(() => (suggestion.value ? compareAmount(props.item.amountVnd, suggestion.value.totalVnd) : null))

const armed = ref(false)
const choosing = ref(false)
const writingNote = ref(false)
const note = ref('')

const assignLabel = computed(() => {
  const code = suggestion.value?.publicCode
  const diff = comparison.value
  if (!diff || diff.kind === 'EXACT') return `Gán vào đơn #${code}`
  const word = diff.kind === 'UNDER' ? 'thiếu' : 'thừa'
  return armed.value ? `Xác nhận nhận ${word} ${formatVnd(diff.diffVnd)}` : `Gán vào đơn #${code} (${word} ${formatVnd(diff.diffVnd)})`
})

function assign() {
  if (!suggestion.value) return
  if (comparison.value && comparison.value.kind !== 'EXACT' && !armed.value) {
    armed.value = true
    return
  }
  emit('assign', suggestion.value.id, armed.value)
}

function resolveWith(resolution: Resolution) {
  emit('resolve', resolution, undefined)
}

function confirmOther() {
  emit('resolve', 'OTHER', note.value.trim())
}
</script>

<template>
  <ZCard variant="raised" padding="md">
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <p class="font-mono text-xl font-medium text-default">
          {{ formatVnd(item.amountVnd) }}
        </p>
        <ZBadge v-if="item.status === 'RESOLVED' && item.resolution" status="success" size="sm">
          {{ RESOLUTION_LABEL[item.resolution] }}
        </ZBadge>
      </div>

      <p v-if="item.reason" class="text-sm font-medium" :class="{ 'text-error': reasonStatus(item.reason) === 'error', 'text-warning': reasonStatus(item.reason) === 'warning' }">
        {{ REVIEW_REASON_LABEL[item.reason] }}
      </p>

      <dl class="grid gap-1 text-sm text-muted">
        <div v-if="item.content" class="flex gap-2">
          <dt class="shrink-0">
            Nội dung:
          </dt>
          <dd class="min-w-0 break-words text-default">
            {{ item.content }}
          </dd>
        </div>
        <div class="flex gap-2">
          <dt class="shrink-0">
            Tài khoản nhận:
          </dt>
          <dd class="font-mono text-default">
            ••••{{ item.accountLast4 }} · {{ formatDateTime(item.transactionDate) }}
          </dd>
        </div>
        <div v-if="item.matchedOrder" class="flex gap-2">
          <dt class="shrink-0">
            Mã trên giao dịch thuộc:
          </dt>
          <dd class="font-mono text-default">
            #{{ item.matchedOrder.publicCode }} ({{ formatVnd(item.matchedOrder.totalVnd) }})
          </dd>
        </div>
      </dl>

      <template v-if="isOpen">
        <ZButton v-if="suggestion" size="lg" block :variant="armed ? 'destructive' : 'primary'" :disabled="busy" :loading="busy" @click="assign">
          {{ assignLabel }}
        </ZButton>
        <ZAlert v-else color="info" description="Chưa thấy đơn nào khớp số tiền này. Kiểm tra lại với khách hoặc chọn Hoàn/bỏ qua." />

        <ZButton v-if="!choosing" variant="secondary" block :disabled="busy" @click="choosing = true">
          Hoàn/bỏ qua
        </ZButton>
        <div v-else class="flex flex-col gap-2">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ZButton v-for="resolution in quickResolutions" :key="resolution" variant="secondary" :disabled="busy" @click="resolveWith(resolution)">
              {{ RESOLUTION_LABEL[resolution] }}
            </ZButton>
            <ZButton variant="secondary" :disabled="busy" @click="writingNote = true">
              {{ RESOLUTION_LABEL.OTHER }}
            </ZButton>
          </div>
          <div v-if="writingNote" class="flex flex-col gap-2">
            <ZFormField label="Ghi chú">
              <ZInput v-model="note" placeholder="Ví dụ: khách chuyển nhầm, đã trả lại" />
            </ZFormField>
            <ZButton :disabled="busy || note.trim().length < 3" @click="confirmOther">
              Xác nhận
            </ZButton>
          </div>
        </div>
      </template>
    </div>
  </ZCard>
</template>
