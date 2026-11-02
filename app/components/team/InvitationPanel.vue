<script setup lang="ts">
import type { AcceptInvitationResult, InvitationPreview } from '#shared/types/team'

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))
const api = useApi()
const { user, signOut } = useAuth()
const { load } = useMe()
const { setActiveStore } = useActiveStore()

const { data: preview, error: loadErrorRaw, status } = await useAsyncData(
  () => `invitation-${token.value}`,
  () => api<InvitationPreview>(`/api/invitations/${token.value}`),
)
const loadError = computed(() => (loadErrorRaw.value ? describeAcceptError(extractApiError(loadErrorRaw.value)) : null))

const accepting = ref(false)
const acceptError = ref<string | null>(null)

async function accept() {
  if (accepting.value || !preview.value?.emailMatches) return
  accepting.value = true
  acceptError.value = null
  try {
    const result = await api<AcceptInvitationResult>(`/api/invitations/${token.value}/accept`, { method: 'POST' })
    await load(true)
    setActiveStore(result.store.id)
    await navigateTo('/app/orders')
  }
  catch (err) {
    acceptError.value = describeAcceptError(extractApiError(err))
  }
  finally {
    accepting.value = false
  }
}

async function switchAccount() {
  await signOut()
  await navigateTo({ path: '/login', query: { redirect: route.fullPath } })
}
</script>

<template>
  <AppAuthShell title="Tham gia quán" description="Bạn được chủ quán mời làm nhân viên.">
    <div v-if="status === 'pending'" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải lời mời">
      <USkeleton class="h-24 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="loadError" color="error" title="Không mở được lời mời" :description="loadError">
      <template #actions>
        <ZButton variant="secondary" size="sm" to="/app">
          Về trang chính
        </ZButton>
      </template>
    </ZAlert>

    <div v-else-if="preview" class="flex flex-col gap-5">
      <ZCard variant="flat" padding="md">
        <p class="text-muted">Quán</p>
        <p class="text-h3 text-default" data-testid="invite-store-name">{{ preview.storeName }}</p>
        <p class="mt-3 text-sm text-muted">Lời mời gửi tới <span class="font-mono">{{ preview.emailHint }}</span></p>
        <p class="text-sm text-muted">Bạn đang đăng nhập bằng <span class="font-mono">{{ user?.email }}</span></p>
      </ZCard>

      <ZAlert
        v-if="!preview.emailMatches"
        color="warning"
        title="Email không khớp với lời mời"
        description="Hãy đăng xuất và đăng nhập (hoặc đăng ký) bằng đúng email được mời."
      >
        <template #actions>
          <ZButton variant="secondary" size="sm" @click="switchAccount()">
            Đăng xuất để dùng email khác
          </ZButton>
        </template>
      </ZAlert>

      <ZAlert v-if="acceptError" color="error" :title="acceptError" />

      <ZButton size="lg" block :loading="accepting" :disabled="!preview.emailMatches" @click="accept()">
        Tham gia quán
      </ZButton>
    </div>
  </AppAuthShell>
</template>
