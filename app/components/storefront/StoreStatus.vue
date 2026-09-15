<script setup lang="ts">
import type { StorefrontAvailability } from '../../../shared/types/availability'

const props = defineProps<{
  availability: StorefrontAvailability
}>()

const presentation = computed(() => {
  if (props.availability.status === 'open') {
    return {
      label: 'Đang mở cửa',
      detail: props.availability.orderingEnabled ? 'Sẵn sàng nhận đơn' : 'Chưa hỗ trợ nhận đơn',
      tone: 'success',
    }
  }

  if (props.availability.status === 'temporarily_closed') {
    return {
      label: 'Tạm ngưng nhận đơn',
      detail: 'Cửa hàng sẽ sớm hoạt động lại',
      tone: 'warning',
    }
  }

  return {
    label: 'Đã đóng cửa',
    detail: props.availability.nextOpeningAt ? 'Vui lòng quay lại vào khung giờ mở cửa' : 'Chưa có lịch mở cửa tiếp theo',
    tone: 'muted',
  }
})
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-4 py-3"
    aria-live="polite"
  >
    <div class="flex min-w-0 items-center gap-3">
      <span
        class="size-2.5 shrink-0 rounded-full"
        :class="{
          'bg-[rgb(var(--success))]': presentation.tone === 'success',
          'bg-[rgb(var(--warning))]': presentation.tone === 'warning',
          'bg-[rgb(var(--muted))]': presentation.tone === 'muted',
        }"
        aria-hidden="true"
      />
      <div class="min-w-0">
        <p class="font-bold">
          {{ presentation.label }}
        </p>
        <p class="truncate text-xs text-[rgb(var(--muted))]">
          {{ presentation.detail }}
        </p>
      </div>
    </div>

    <div class="flex shrink-0 gap-1.5 text-xs font-semibold text-[rgb(var(--muted))]">
      <span v-if="availability.fulfillment.delivery">Giao hàng</span>
      <span v-if="availability.fulfillment.delivery && availability.fulfillment.pickup">·</span>
      <span v-if="availability.fulfillment.pickup">Tự lấy</span>
    </div>
  </div>
</template>
