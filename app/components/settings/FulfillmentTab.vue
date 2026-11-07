<script setup lang="ts">
import { formatVnd, parseVndInput } from '#shared/money'
import { vndSchema } from '#shared/schemas/common'
import type { DeliveryZoneDTO } from '#shared/types/catalog'
import type { StoreDetail } from '#shared/types/identity'

type ModeKey = 'dineInEnabled' | 'pickupEnabled' | 'deliveryEnabled'

const props = defineProps<{ store: StoreDetail }>()
const emit = defineEmits<{ changed: [] }>()

const api = useApi()
const toast = useToast()

const modes = reactive<Record<ModeKey, boolean>>({
  dineInEnabled: props.store.dineInEnabled,
  pickupEnabled: props.store.pickupEnabled,
  deliveryEnabled: props.store.deliveryEnabled,
})
// The parent keys this component by store.id. Background refreshes for this
// store can be older than a pending toggle; they must not overwrite its draft.
const savingMode = ref(false)

const modeRows: { key: ModeKey, label: string, description: string }[] = [
  { key: 'dineInEnabled', label: 'Tại bàn', description: 'Khách quét QR trên bàn để gọi món.' },
  { key: 'pickupEnabled', label: 'Mang đi', description: 'Khách đặt trước rồi tới quán lấy.' },
  { key: 'deliveryEnabled', label: 'Giao hàng', description: 'Giao theo khu vực và phí bạn đặt bên dưới.' },
]

const zones = ref<DeliveryZoneDTO[]>([])
const zonesStatus = ref<'pending' | 'success' | 'error'>('pending')
const drafts = reactive<Record<string, { name: string, fee: string }>>({})
const newZone = reactive({ name: '', fee: '' })
const zoneErrors = reactive({ name: '', fee: '' })
const addingZone = ref(false)
const savingZoneId = ref<string | null>(null)

const zonesUrl = computed(() => `/api/stores/${props.store.id}/delivery-zones`)
const hasActiveZone = computed(() => zones.value.some(zone => zone.active))

function syncDraft(zone: DeliveryZoneDTO) {
  drafts[zone.id] = { name: zone.name, fee: String(zone.feeVnd) }
}

function replaceZone(zone: DeliveryZoneDTO) {
  zones.value = zones.value.map(item => (item.id === zone.id ? zone : item))
  syncDraft(zone)
}

async function loadZones() {
  zonesStatus.value = 'pending'
  try {
    const result = await api<{ zones: DeliveryZoneDTO[] }>(zonesUrl.value)
    zones.value = result.zones
    result.zones.forEach(syncDraft)
    zonesStatus.value = 'success'
  }
  catch {
    zonesStatus.value = 'error'
  }
}
loadZones()

async function setMode(key: ModeKey, value: boolean) {
  if (savingMode.value) return
  savingMode.value = true
  const previous = modes[key]
  modes[key] = value
  try {
    await api(`/api/stores/${props.store.id}/fulfillment`, { method: 'PATCH', body: { [key]: value } })
    emit('changed')
  }
  catch (err) {
    modes[key] = previous
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally { savingMode.value = false }
}

async function addZone() {
  if (addingZone.value) return
  const fee = parseVndInput(newZone.fee)
  zoneErrors.name = newZone.name.trim() ? '' : 'Nhập tên khu vực'
  zoneErrors.fee = fee !== null && vndSchema.safeParse(fee).success ? '' : 'Nhập phí giao hợp lệ, ví dụ 15k (nhập 0 nếu miễn phí)'
  if (zoneErrors.name || zoneErrors.fee || fee === null) return
  addingZone.value = true
  try {
    const created = await api<DeliveryZoneDTO>(zonesUrl.value, { method: 'POST', body: { name: newZone.name.trim(), feeVnd: fee } })
    zones.value = [...zones.value, created]
    syncDraft(created)
    newZone.name = ''
    newZone.fee = ''
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    addingZone.value = false
  }
}

function zoneDirty(zone: DeliveryZoneDTO): boolean {
  const draft = drafts[zone.id]
  return !!draft && (draft.name.trim() !== zone.name || parseVndInput(draft.fee) !== zone.feeVnd)
}

async function saveZone(zone: DeliveryZoneDTO) {
  const draft = drafts[zone.id]
  const fee = draft ? parseVndInput(draft.fee) : null
  if (!draft || !draft.name.trim() || fee === null || !vndSchema.safeParse(fee).success) {
    toast.add({ color: 'error', title: 'Kiểm tra lại tên và phí giao của khu vực' })
    return
  }
  savingZoneId.value = zone.id
  try {
    replaceZone(await api<DeliveryZoneDTO>(`${zonesUrl.value}/${zone.id}`, { method: 'PATCH', body: { name: draft.name.trim(), feeVnd: fee } }))
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    savingZoneId.value = null
  }
}

async function setZoneActive(zone: DeliveryZoneDTO, active: boolean) {
  zones.value = zones.value.map(item => (item.id === zone.id ? { ...item, active } : item))
  try {
    await api(`${zonesUrl.value}/${zone.id}`, { method: 'PATCH', body: { active } })
  }
  catch (err) {
    zones.value = zones.value.map(item => (item.id === zone.id ? zone : item))
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <ZCard title="Hình thức nhận món" description="Gạt là lưu ngay. Cần bật ít nhất một hình thức." padding="lg">
      <div class="flex flex-col gap-2">
        <ZSwitch
          v-for="row in modeRows"
          :key="row.key"
          :model-value="modes[row.key]"
          :label="row.label"
          :description="row.description"
          :disabled="savingMode"
          @update:model-value="setMode(row.key, $event)"
        />
      </div>
    </ZCard>

    <ZCard title="Khu vực giao hàng" description="Phí giao tính theo khu vực. Khách chọn khu vực rồi nhập địa chỉ chi tiết." padding="lg">
      <div class="flex flex-col gap-4">
        <ZAlert v-if="modes.deliveryEnabled && zonesStatus === 'success' && !hasActiveZone" color="warning" title="Chưa có khu vực giao đang bật — khách chưa chọn được Giao hàng." />

        <ZAlert v-if="zonesStatus === 'error'" color="error" title="Không tải được khu vực giao">
          <template #actions>
            <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="loadZones()">
              Thử lại
            </ZButton>
          </template>
        </ZAlert>

        <ul v-if="zones.length > 0" class="flex flex-col gap-3">
          <li v-for="zone in zones" :key="zone.id" class="flex flex-col gap-3 rounded-md p-3 ring-1 ring-default">
            <div class="flex items-center gap-2">
              <ZInput v-if="drafts[zone.id]" v-model="drafts[zone.id]!.name" aria-label="Sửa tên khu vực" autocomplete="off" class="flex-1" />
              <ZInput v-if="drafts[zone.id]" v-model="drafts[zone.id]!.fee" aria-label="Sửa phí giao" inputmode="numeric" autocomplete="off" class="w-28" />
            </div>
            <div class="flex items-center justify-between gap-2">
              <ZSwitch :model-value="zone.active" label="Đang giao" @update:model-value="setZoneActive(zone, $event)" />
              <ZButton v-if="zoneDirty(zone)" size="sm" :loading="savingZoneId === zone.id" @click="saveZone(zone)">
                Lưu
              </ZButton>
              <span v-else class="font-mono text-sm text-muted">{{ formatVnd(zone.feeVnd) }}</span>
            </div>
          </li>
        </ul>

        <form class="flex flex-col gap-3" novalidate @submit.prevent="addZone">
          <ZFormField label="Tên khu vực" :error="zoneErrors.name">
            <ZInput v-model="newZone.name" placeholder="Ví dụ: Quận 1" autocomplete="off" />
          </ZFormField>
          <ZFormField label="Phí giao (đ)" :error="zoneErrors.fee">
            <ZInput v-model="newZone.fee" inputmode="numeric" placeholder="15k" autocomplete="off" />
          </ZFormField>
          <ZButton type="submit" variant="secondary" icon="i-lucide-plus" :loading="addingZone">
            Thêm khu vực
          </ZButton>
        </form>
      </div>
    </ZCard>
  </div>
</template>
