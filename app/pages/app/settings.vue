<script setup lang="ts">
import type { StoreDetail } from '#shared/types/identity'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Cài đặt — ZENO' })

const api = useApi()
const toast = useToast()
const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const { load } = useMe()

const { data: store, status, refresh } = await useAsyncData(
  'store-settings',
  () => api<StoreDetail>(`/api/stores/${activeStore.value!.id}`),
  { watch: [() => activeStore.value?.id] },
)

const draft = reactive({ name: '', isAcceptingOrders: false })
watch(store, (value) => {
  if (value) Object.assign(draft, { name: value.name, isAcceptingOrders: value.isAcceptingOrders })
}, { immediate: true })

const isOwner = computed(() => store.value?.role === 'OWNER')
const saving = ref(false)
const publicUrl = computed(() => (store.value ? `${config.public.appBaseUrl}/s/${store.value.slug}` : ''))

async function save() {
  if (!store.value) return
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
  <section class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">Cài đặt cửa hàng</h1>

    <USkeleton v-if="status === 'pending'" class="h-40 w-full" />
    <UAlert v-else-if="status === 'error'" color="error" variant="subtle" title="Không tải được cài đặt" />

    <template v-else-if="store">
      <UFormField label="Tên cửa hàng" name="name">
        <UInput v-model="draft.name" :disabled="!isOwner" size="xl" class="w-full" />
      </UFormField>

      <USwitch v-model="draft.isAcceptingOrders" :disabled="!isOwner" label="Đang nhận đơn" description="Tắt khi quán tạm nghỉ; khách vẫn xem được menu." />

      <UFormField label="Link đặt món">
        <UInput :model-value="publicUrl" readonly size="xl" class="w-full" />
      </UFormField>

      <UButton v-if="isOwner" size="xl" block :loading="saving" @click="save">Lưu thay đổi</UButton>
      <p v-else class="text-sm text-muted">Chỉ chủ cửa hàng mới thay đổi được cài đặt.</p>
    </template>
  </section>
</template>
