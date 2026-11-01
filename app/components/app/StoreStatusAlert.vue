<script setup lang="ts">
const api = useApi()
const toast = useToast()
const { load } = useMe()
const { activeStore } = useActiveStore()

const enabling = ref(false)

async function enableOrders() {
  const store = activeStore.value
  if (!store || store.role !== 'OWNER' || enabling.value) return
  enabling.value = true
  try {
    await api(`/api/stores/${store.id}`, { method: 'PATCH', body: { isAcceptingOrders: true } })
    await load(true)
    toast.add({ color: 'success', title: 'Quán đã bật nhận đơn' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    enabling.value = false
  }
}
</script>

<template>
  <ZAlert
    v-if="activeStore && !activeStore.isAcceptingOrders"
    color="warning"
    title="Quán đang tạm nghỉ — khách không đặt được món"
  >
    <template v-if="activeStore.role === 'OWNER'" #actions>
      <ZButton variant="secondary" size="sm" icon="i-lucide-power" :loading="enabling" @click="enableOrders">
        Bật nhận đơn
      </ZButton>
    </template>
  </ZAlert>
</template>
