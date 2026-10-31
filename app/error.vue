<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)
const title = computed(() => (notFound.value ? 'Không tìm thấy trang' : 'Đã có lỗi xảy ra'))
const description = computed(() => (notFound.value
  ? 'Đường dẫn có thể đã thay đổi hoặc không còn tồn tại.'
  : 'Vui lòng thử lại sau ít phút.'))

useHead({ title })

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <UApp>
    <main class="flex min-h-dvh flex-col items-center justify-center bg-default px-4 py-10">
      <AppLogo class="mb-6" />
      <AppEmptyState
        heading-level="h1"
        :icon="notFound ? 'i-lucide-map-pin-off' : 'i-lucide-coffee'"
        :title="title"
        :description="description"
      >
        <template #actions>
          <ZButton size="lg" block @click="goHome">
            Về trang chủ
          </ZButton>
        </template>
      </AppEmptyState>
    </main>
  </UApp>
</template>
