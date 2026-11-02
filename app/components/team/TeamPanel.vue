<script setup lang="ts">
import TeamInvitationForm from './InvitationForm.vue'
import TeamMemberList from './MemberList.vue'
import { inviteInputSchema } from '#shared/schemas/team'
import type { CreatedInvitation, TeamMember, TeamResponse } from '#shared/types/team'

const api = useApi()
const toast = useToast()
const { activeStore } = useActiveStore()
const isOwner = computed(() => activeStore.value?.role === 'OWNER')

const { data: team, status, refresh } = await useAsyncData(
  () => `team-${activeStore.value?.id ?? 'none'}-${activeStore.value?.role ?? 'none'}`,
  async () => {
    const id = activeStore.value?.id
    return id && isOwner.value ? await api<TeamResponse>(`/api/stores/${id}/team`) : null
  },
)

const email = ref('')
const inviting = ref(false)
const formError = ref<string | null>(null)
const created = ref<CreatedInvitation | null>(null)

async function invite() {
  if (!activeStore.value || !isOwner.value || inviting.value) return
  const storeId = activeStore.value.id
  const parsed = inviteInputSchema.safeParse({ email: email.value })
  if (!parsed.success) {
    formError.value = 'Email không hợp lệ'
    return
  }
  inviting.value = true
  formError.value = null
  try {
    const result = await api<CreatedInvitation>(`/api/stores/${storeId}/team/invitations`, { method: 'POST', body: parsed.data })
    if (activeStore.value?.id !== storeId) return
    created.value = result
    email.value = ''
    await refresh()
  }
  catch (err) {
    if (activeStore.value?.id !== storeId) return
    const error = extractApiError(err)
    const reason = (error.details as { reason?: string } | undefined)?.reason
    formError.value = reason === 'ALREADY_MEMBER' ? 'Người này đã là thành viên của quán.' : error.message
  }
  finally {
    inviting.value = false
  }
}

const mutationPending = ref(false)

watch(() => activeStore.value?.id, () => {
  created.value = null
  email.value = ''
  formError.value = null
})

async function setStatus(member: TeamMember, next: 'ACTIVE' | 'DISABLED') {
  if (!isOwner.value || !activeStore.value || mutationPending.value) return
  mutationPending.value = true
  try {
    await api(`/api/stores/${activeStore.value!.id}/team/${member.userId}`, { method: 'PATCH', body: { status: next } })
    toast.add({ color: 'success', title: next === 'DISABLED' ? 'Đã khóa nhân viên' : 'Đã mở lại nhân viên' })
    await refresh()
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    mutationPending.value = false
  }
}

async function revoke(id: string) {
  if (!isOwner.value || !activeStore.value || mutationPending.value) return
  mutationPending.value = true
  try {
    await api(`/api/stores/${activeStore.value!.id}/team/invitations/${id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    mutationPending.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Nhân viên" description="Mời nhân viên bằng link và quản lý quyền vào quán." />

    <ZAlert v-if="!isOwner" color="info" title="Chỉ chủ cửa hàng mới quản lý được nhân viên." />

    <template v-else>
      <TeamInvitationForm v-model="email" :inviting="inviting" :form-error="formError" :created="created" @invite="invite" @dismiss="created = null" />

      <div v-if="status === 'pending' && !team" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải danh sách">
        <USkeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-md" />
      </div>

      <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được danh sách nhân viên">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>

      <TeamMemberList v-else-if="team" :team="team" :mutation-pending="mutationPending" @set-status="setStatus" @revoke="revoke" />
    </template>
  </div>
</template>
