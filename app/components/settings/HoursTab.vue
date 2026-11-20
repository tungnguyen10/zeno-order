<script setup lang="ts">
import { hhmmToMinutes, type OpeningHours } from '#shared/store-hours'
import type { StoreDetail } from '#shared/types/identity'

interface DayDraft {
  closed: boolean
  open: string
  close: string
}

const props = defineProps<{ store: StoreDetail }>()
const emit = defineEmits<{ changed: [] }>()

const api = useApi()
const toast = useToast()

// Monday-first display order mapped onto the stored Sunday-indexed week (0 = Sunday … 6 = Saturday).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS: Record<number, string> = { 0: 'Chủ nhật', 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7' }

function initDays(hours: OpeningHours | null): DayDraft[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = hours?.days?.[index] ?? null
    return day ? { closed: false, open: day.open, close: day.close } : { closed: true, open: '07:00', close: '22:00' }
  })
}

const enabled = ref(props.store.openingHours?.enabled ?? false)
const days = reactive<DayDraft[]>(initDays(props.store.openingHours))
const saving = ref(false)

watch(() => props.store, (store) => {
  enabled.value = store.openingHours?.enabled ?? false
  initDays(store.openingHours).forEach((day, index) => Object.assign(days[index]!, day))
})

const invalidDay = computed(() => days.findIndex(day => !day.closed && hhmmToMinutes(day.close) <= hhmmToMinutes(day.open)))

async function saveHours() {
  if (saving.value) return
  if (invalidDay.value !== -1) {
    toast.add({ color: 'error', title: `${DAY_LABELS[invalidDay.value]}: giờ đóng phải sau giờ mở` })
    return
  }
  const payload: OpeningHours = {
    enabled: enabled.value,
    days: days.map(day => (day.closed ? null : { open: day.open, close: day.close })),
  }
  saving.value = true
  try {
    await api(`/api/stores/${props.store.id}`, { method: 'PATCH', body: { openingHours: payload } })
    emit('changed')
    toast.add({ color: 'success', title: 'Đã lưu giờ hoạt động' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    saving.value = false
  }
}

// ---- Quick pause ----
const VN_OFFSET_MS = 420 * 60_000
const pausing = ref(false)

const pausedUntilMs = computed(() => (props.store.pausedUntil ? Date.parse(props.store.pausedUntil) : null))
const isPaused = computed(() => pausedUntilMs.value !== null && pausedUntilMs.value > Date.now())
const pausedLabel = computed(() => {
  if (!isPaused.value || pausedUntilMs.value === null) return ''
  const vn = new Date(pausedUntilMs.value + VN_OFFSET_MS)
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`
})

function endOfVnTodayIso(): string {
  const vn = new Date(Date.now() + VN_OFFSET_MS)
  const nextVnMidnightUtc = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + 1) - VN_OFFSET_MS
  return new Date(nextVnMidnightUtc).toISOString()
}

async function setPause(pausedUntil: string | null) {
  if (pausing.value) return
  pausing.value = true
  try {
    await api(`/api/stores/${props.store.id}`, { method: 'PATCH', body: { pausedUntil } })
    emit('changed')
    toast.add({ color: 'success', title: pausedUntil ? 'Đã tạm đóng nhận đơn' : 'Đã mở lại nhận đơn' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    pausing.value = false
  }
}

function pauseMinutes(minutes: number) {
  return setPause(new Date(Date.now() + minutes * 60_000).toISOString())
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <ZCard title="Tạm đóng nhanh" description="Đóng nhận đơn trong chốc lát mà không đổi giờ mở cố định." padding="lg">
      <div class="flex flex-col gap-3">
        <ZAlert v-if="isPaused" color="warning" :title="`Đang tạm đóng đến ${pausedLabel}`" description="Khách vẫn xem được menu nhưng chưa đặt được." />
        <div class="flex flex-wrap gap-2">
          <ZButton variant="secondary" :loading="pausing" @click="pauseMinutes(30)">Đóng 30 phút</ZButton>
          <ZButton variant="secondary" :loading="pausing" @click="pauseMinutes(60)">Đóng 1 giờ</ZButton>
          <ZButton variant="secondary" :loading="pausing" @click="setPause(endOfVnTodayIso())">Đóng đến hết hôm nay</ZButton>
          <ZButton v-if="isPaused" variant="primary" :loading="pausing" @click="setPause(null)">Mở lại ngay</ZButton>
        </div>
      </div>
    </ZCard>

    <ZCard title="Giờ mở cửa theo tuần" description="Khi bật, khách chỉ đặt được trong khung giờ mở cửa (giờ Việt Nam)." padding="lg">
      <div class="flex flex-col gap-4">
        <ZSwitch v-model="enabled" label="Áp dụng giờ mở cửa" description="Tắt để nhận đơn bất kể giờ nào (chỉ phụ thuộc nút Đang nhận đơn)." />

        <ul v-if="enabled" class="flex flex-col gap-2">
          <li v-for="index in DAY_ORDER" :key="index" class="flex flex-wrap items-center gap-3 rounded-md p-3 ring-1 ring-default">
            <span class="w-20 shrink-0 font-medium text-default">{{ DAY_LABELS[index] }}</span>
            <ZSwitch
              :model-value="!days[index]!.closed"
              label="Mở"
              @update:model-value="days[index]!.closed = !$event"
            />
            <div v-if="!days[index]!.closed" class="flex items-center gap-2">
              <input
                v-model="days[index]!.open"
                type="time"
                :aria-label="`Giờ mở ${DAY_LABELS[index]}`"
                class="min-h-11 rounded-md bg-(--zeno-surface-inset) px-3 text-default ring-1 ring-default focus-visible:outline-2 focus-visible:outline-primary"
              >
              <span class="text-muted">–</span>
              <input
                v-model="days[index]!.close"
                type="time"
                :aria-label="`Giờ đóng ${DAY_LABELS[index]}`"
                class="min-h-11 rounded-md bg-(--zeno-surface-inset) px-3 text-default ring-1 ring-default focus-visible:outline-2 focus-visible:outline-primary"
              >
            </div>
            <span v-else class="text-sm text-muted">Nghỉ</span>
          </li>
        </ul>

        <ZButton type="button" class="self-start" :loading="saving" @click="saveHours">
          Lưu giờ hoạt động
        </ZButton>
      </div>
    </ZCard>
  </div>
</template>
