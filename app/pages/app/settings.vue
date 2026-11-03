<script setup lang="ts">
import type { StoreDetail } from '#shared/types/identity'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Cài đặt' })

const api = useApi()
const toast = useToast()
const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const { load } = useMe()

const { data: store, status, refresh } = await useAsyncData(
  'store-settings',
  async () => {
    const id = activeStore.value?.id
    return id ? await api<StoreDetail>(`/api/stores/${id}`) : null
  },
  { watch: [() => activeStore.value?.id] },
)

const draft = reactive({ name: '', isAcceptingOrders: false })
function resetDraft() {
  if (store.value) Object.assign(draft, { name: store.value.name, isAcceptingOrders: store.value.isAcceptingOrders })
}
watch(store, resetDraft, { immediate: true })

const isOwner = computed(() => store.value?.role === 'OWNER')
const route = useRoute()
const router = useRouter()
const tabItems = [
  { label: 'Cửa hàng', value: 'store' },
  { label: 'Nhận món & khu vực giao', value: 'fulfillment' },
  { label: 'Bàn & QR', value: 'tables' },
  { label: 'Thanh toán', value: 'payment' },
]
const tab = computed({
  get: () => {
    const requested = typeof route.query.tab === 'string' ? route.query.tab : 'store'
    return isOwner.value && tabItems.some(item => item.value === requested) ? requested : 'store'
  },
  set: (value: string) => {
    if (value !== tab.value) void router.push({ query: { ...route.query, tab: value === 'store' ? undefined : value } })
  },
})
const isDirty = computed(() => !!store.value && isOwner.value
  && (draft.name !== store.value.name || draft.isAcceptingOrders !== store.value.isAcceptingOrders))
const saving = ref(false)
const publicUrl = computed(() => (store.value ? `${config.public.appBaseUrl}/s/${store.value.slug}` : ''))

useUnsavedChangesGuard(isDirty)

onBeforeRouteUpdate((to) => {
  const requested = typeof to.query.tab === 'string' ? to.query.tab : 'store'
  const nextTab = isOwner.value && tabItems.some(item => item.value === requested) ? requested : 'store'
  if (nextTab !== tab.value && isDirty.value) {
    if (!window.confirm('Bạn có thay đổi chưa lưu. Rời trang?')) return false
    resetDraft()
  }
})

async function onFulfillmentChanged() {
  await Promise.all([refresh(), load(true)])
}

async function save() {
  if (!store.value || !isDirty.value) return
  saving.value = true
  try {
    await api(`/api/stores/${store.value.id}`, { method: 'PATCH', body: { ...draft } })
    await Promise.all([refresh(), load(true)])
    toast.add({ color: 'success', title: 'Đã lưu cài đặt' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6" :class="{ 'pb-20 md:pb-0': isDirty }">
    <AppPageHeader title="Cài đặt cửa hàng" description="Thông tin hiển thị cho khách và trạng thái nhận đơn." />
    <ZTabs v-if="isOwner" v-model="tab" :items="tabItems" />

    <div v-if="status === 'pending' && !store" class="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải cài đặt">
      <USkeleton v-for="i in 3" :key="i" class="h-32 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được cài đặt">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else-if="store">
      <ZAlert v-if="!isOwner" color="info" title="Chỉ chủ cửa hàng mới thay đổi được cài đặt." />

      <form v-if="tab === 'store'" id="store-settings" class="flex flex-col gap-6" @submit.prevent="save">
        <ZCard title="Thông tin cửa hàng" padding="lg">
          <ZFormField label="Tên cửa hàng" name="name">
            <ZInput v-model="draft.name" :disabled="!isOwner" size="lg" autocomplete="organization" />
          </ZFormField>
        </ZCard>

        <ZCard title="Nhận đơn" padding="lg">
          <ZSwitch
            v-model="draft.isAcceptingOrders"
            :disabled="!isOwner"
            label="Đang nhận đơn"
            description="Tắt khi quán tạm nghỉ; khách vẫn xem được menu."
          />
        </ZCard>

        <ZCard title="Link đặt món" description="Gửi cho khách hoặc in lên QR tại bàn." padding="lg">
          <div class="flex flex-col gap-3">
            <AppCopyField :value="publicUrl" label="Link đặt món" />
            <ZButton variant="ghost" icon="i-lucide-external-link" :to="publicUrl" target="_blank" class="self-start">
              Mở trang khách
            </ZButton>
          </div>
        </ZCard>

        <div v-if="isOwner" class="hidden md:flex md:justify-end md:gap-3">
          <ZButton variant="ghost" :disabled="!isDirty || saving" @click="resetDraft">
            Hủy
          </ZButton>
          <ZButton type="submit" :disabled="!isDirty" :loading="saving">
            Lưu thay đổi
          </ZButton>
        </div>
      </form>

      <SettingsFulfillmentTab v-if="tab === 'fulfillment'" :key="store.id" :store="store" @changed="onFulfillmentChanged" />
      <SettingsPaymentTab v-if="isOwner && tab === 'payment'" :key="store.id" :store-id="store.id" :org-id="store.orgId" />
      <SettingsTablesTab v-if="tab === 'tables'" :key="store.id" :store="store" />

      <div
        v-if="isOwner && tab === 'store'"
        v-show="isDirty"
        class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 border-t border-default bg-default/95 px-4 py-3 backdrop-blur md:hidden"
      >
        <div class="mx-auto flex max-w-lg gap-3">
          <ZButton variant="ghost" :disabled="saving" @click="resetDraft">
            Hủy
          </ZButton>
          <ZButton type="submit" form="store-settings" class="flex-1" :loading="saving">
            Lưu thay đổi
          </ZButton>
        </div>
      </div>
    </template>
  </div>
</template>
