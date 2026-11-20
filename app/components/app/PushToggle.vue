<script setup lang="ts">
const { activeStore } = useActiveStore()
const push = usePushNotifications()

async function toggle() {
  const id = activeStore.value?.id
  if (!id) return
  if (push.enabled.value) await push.disable(id)
  else await push.enable(id)
}
</script>

<template>
  <ZButton
    v-if="push.supported.value"
    variant="ghost"
    :icon="push.enabled.value ? 'i-lucide-bell-ring' : 'i-lucide-bell-plus'"
    :loading="push.busy.value"
    :aria-label="push.enabled.value ? 'Tắt thông báo đẩy đơn mới' : 'Bật thông báo đẩy đơn mới'"
    @click="toggle()"
  >
    {{ push.enabled.value ? 'Thông báo bật' : 'Bật thông báo' }}
  </ZButton>
</template>
