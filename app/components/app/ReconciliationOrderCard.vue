<script setup lang="ts">
import { formatVnd } from '#shared/money'

const props = defineProps<{
  kind: 'refund' | 'overdue'
  order: { id: string, publicCode: string, totalVnd: number, heldVnd?: number }
  busy?: boolean
}>()
const emit = defineEmits<{ confirm: [note: string] }>()

const copy = {
  refund: { action: 'Đã hoàn tiền', note: 'Đã hoàn tiền qua chuyển khoản' },
  overdue: { action: 'Đã nhận tiền thủ công', note: 'Đã thấy tiền trong tài khoản ngân hàng' },
} as const

const open = ref(false)
const note = ref('')

function start() {
  note.value = copy[props.kind].note
  open.value = true
}

function confirm() {
  emit('confirm', note.value.trim())
}
</script>

<template>
  <ZCard variant="raised" padding="md">
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <p class="font-mono text-lg font-medium text-default">
          #{{ order.publicCode }}
        </p>
        <p class="font-mono text-default">
          {{ formatVnd(order.totalVnd) }}
        </p>
      </div>
      <p v-if="kind === 'refund'" class="text-sm font-medium text-error">
        Cần hoàn {{ formatVnd(order.heldVnd ?? order.totalVnd) }} cho khách
      </p>
      <p v-else class="text-sm text-muted">
        Mã QR đã hết hạn, chưa thấy tiền về. Nếu bạn đã thấy tiền trong app ngân hàng, hãy xác nhận thủ công.
      </p>

      <ZButton v-if="!open" :variant="kind === 'refund' ? 'primary' : 'secondary'" block :disabled="busy" @click="start">
        {{ copy[kind].action }}
      </ZButton>
      <div v-else class="flex flex-col gap-2">
        <ZFormField label="Ghi chú">
          <ZInput v-model="note" />
        </ZFormField>
        <div class="flex gap-2">
          <ZButton class="flex-1" :disabled="busy || note.trim().length < 3" :loading="busy" @click="confirm">
            Xác nhận
          </ZButton>
          <ZButton variant="ghost" :disabled="busy" @click="open = false">
            Hủy
          </ZButton>
        </div>
      </div>
    </div>
  </ZCard>
</template>
