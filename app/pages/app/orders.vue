<script setup lang="ts">
definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Đơn hàng' })

const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const publicUrl = computed(() => (activeStore.value ? `${config.public.appBaseUrl}/s/${activeStore.value.slug}` : ''))
const viewPath = computed(() => (activeStore.value ? `/s/${activeStore.value.slug}` : ''))
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Đơn hàng" description="Theo dõi và xử lý đơn của quán." />

    <AppStoreStatusAlert />

    <ZCard variant="raised" padding="lg">
      <AppEmptyState
        icon="i-lucide-receipt"
        title="Chưa có đơn hàng nào"
        description="Chia sẻ link đặt món để khách bắt đầu gọi món. Đơn mới sẽ hiện ở đây."
      >
        <template #actions>
          <AppCopyField v-if="publicUrl" :value="publicUrl" label="Link đặt món" />
          <ZButton v-if="viewPath" variant="secondary" block icon="i-lucide-external-link" :to="viewPath" target="_blank">
            Xem trang khách
          </ZButton>
        </template>
      </AppEmptyState>
    </ZCard>
  </div>
</template>
