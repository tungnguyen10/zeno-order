<script setup lang="ts">
const { stores, activeStore, setActiveStore } = useActiveStore()

const storeItems = computed(() => stores.value.map(store => ({ label: store.name, value: store.id })))
const selectedStoreId = computed({
  get: () => activeStore.value?.id,
  set: (id) => {
    if (!id || id === activeStore.value?.id) return
    if (confirmDiscardUnsavedChanges()) setActiveStore(id)
  },
})
</script>

<template>
  <div class="flex min-w-0 items-center gap-2 md:flex-col md:items-stretch md:gap-2">
    <template v-if="storeItems.length > 1">
      <ZSelect v-model="selectedStoreId" :items="storeItems" aria-label="Chọn cửa hàng" class="min-w-0 flex-1" />
      <span data-testid="active-store-name" class="sr-only">{{ activeStore?.name }}</span>
    </template>
    <p v-else data-testid="active-store-name" class="min-w-0 truncate font-semibold text-default md:text-lg">
      {{ activeStore?.name }}
    </p>
    <ZBadge
      v-if="activeStore"
      :status="activeStore.isAcceptingOrders ? 'success' : 'warning'"
      size="sm"
      :icon="activeStore.isAcceptingOrders ? 'i-lucide-circle-dot' : 'i-lucide-pause'"
      class="shrink-0 self-center md:self-start"
    >
      {{ activeStore.isAcceptingOrders ? 'Đang nhận đơn' : 'Tạm nghỉ' }}
    </ZBadge>
  </div>
</template>
