<script setup lang="ts">
import type { TableDTO, TableWithQr } from '#shared/types/catalog'
import type { StoreDetail } from '#shared/types/identity'

const props = defineProps<{ store: StoreDetail }>()

const api = useApi()
const toast = useToast()

const tables = shallowRef<TableDTO[]>([])
const status = shallowRef<'pending' | 'success' | 'error'>('pending')
const adding = shallowRef(false)
const busyId = shallowRef<string | null>(null)
const qr = reactive({ open: false, title: '', url: '' })

const baseUrl = computed(() => `/api/stores/${props.store.id}/tables`)

function toDto(table: TableDTO): TableDTO {
  return { id: table.id, code: table.code, displayName: table.displayName, active: table.active }
}

function showQr(table: TableWithQr) {
  qr.title = table.displayName
  qr.url = table.qrUrl
  qr.open = true
}

watch(() => qr.open, (isOpen) => {
  if (!isOpen) {
    qr.title = ''
    qr.url = ''
  }
})

async function load() {
  status.value = 'pending'
  try {
    tables.value = (await api<{ tables: TableDTO[] }>(baseUrl.value)).tables
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
}

void load()

async function addTable() {
  if (adding.value) return
  adding.value = true
  try {
    const created = await api<TableWithQr>(baseUrl.value, { method: 'POST', body: {} })
    tables.value = [...tables.value, toDto(created)]
    showQr(created)
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    adding.value = false
  }
}

async function regenerate(table: TableDTO) {
  if (!window.confirm(`Mã QR cũ của ${table.displayName} sẽ ngừng hoạt động ngay. Tiếp tục?`)) return
  busyId.value = table.id
  try {
    const renewed = await api<TableWithQr>(`${baseUrl.value}/${table.id}/regenerate`, { method: 'POST' })
    tables.value = tables.value.map(item => (item.id === table.id ? toDto(renewed) : item))
    showQr(renewed)
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    busyId.value = null
  }
}

async function setActive(table: TableDTO, active: boolean) {
  busyId.value = table.id
  try {
    const updated = await api<TableDTO>(`${baseUrl.value}/${table.id}`, { method: 'PATCH', body: { active } })
    tables.value = tables.value.map(item => (item.id === table.id ? updated : item))
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <ZCard title="Bàn & mã QR" description="Mỗi bàn có một mã QR riêng. Mã chỉ hiện một lần khi tạo. Quên tải về thì bấm Tạo lại QR." padding="lg">
      <div class="flex flex-col gap-4">
        <ZButton size="lg" block icon="i-lucide-plus" :loading="adding" @click="addTable">
          Thêm bàn
        </ZButton>

        <div v-if="status === 'pending' && tables.length === 0" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải danh sách bàn">
          <USkeleton v-for="i in 2" :key="i" class="h-16 w-full rounded-md" />
        </div>

        <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được danh sách bàn">
          <template #actions>
            <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="load">
              Thử lại
            </ZButton>
          </template>
        </ZAlert>

        <AppEmptyState
          v-else-if="tables.length === 0"
          icon="i-lucide-qr-code"
          title="Chưa có bàn nào"
          description="Bấm Thêm bàn để tạo bàn đầu tiên và mã QR của bàn đó."
        />

        <ul v-else class="flex flex-col gap-3">
          <li v-for="table in tables" :key="table.id" class="flex flex-col gap-3 rounded-md p-3 ring-1 ring-default">
            <div class="flex items-center justify-between gap-2">
              <p class="min-w-0 break-words font-medium text-default">
                {{ table.displayName }}
              </p>
              <ZBadge :status="table.active ? 'success' : 'neutral'" size="sm">
                {{ table.active ? 'Đang dùng' : 'Đã thu hồi' }}
              </ZBadge>
            </div>
            <div class="flex flex-wrap gap-2">
              <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" :loading="busyId === table.id" :aria-label="`Tạo lại QR ${table.displayName}`" @click="regenerate(table)">
                Tạo lại QR
              </ZButton>
              <ZButton
                v-if="table.active"
                variant="ghost"
                size="sm"
                icon="i-lucide-ban"
                :disabled="busyId === table.id"
                :aria-label="`Thu hồi ${table.displayName}`"
                @click="setActive(table, false)"
              >
                Thu hồi
              </ZButton>
              <ZButton
                v-else
                variant="ghost"
                size="sm"
                icon="i-lucide-rotate-ccw"
                :disabled="busyId === table.id"
                :aria-label="`Dùng lại ${table.displayName}`"
                @click="setActive(table, true)"
              >
                Dùng lại
              </ZButton>
            </div>
          </li>
        </ul>
      </div>
    </ZCard>

    <SettingsTableQrSheet v-model:open="qr.open" :title="qr.title" :url="qr.url" :slug="store.slug" />
  </div>
</template>
