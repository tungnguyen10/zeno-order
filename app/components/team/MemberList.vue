<script setup lang="ts">
import type { TeamMember, TeamResponse } from '#shared/types/team'

defineProps<{ team: TeamResponse, mutationPending: boolean }>()
const emit = defineEmits<{ setStatus: [member: TeamMember, next: 'ACTIVE' | 'DISABLED'], revoke: [id: string] }>()
</script>

<template>
  <div class="flex flex-col gap-6">
    <ZCard title="Thành viên" padding="lg">
      <ul class="flex flex-col divide-y divide-(--zeno-border)">
        <li v-for="member in team.members" :key="member.userId" class="flex flex-wrap items-center justify-between gap-3 py-3" :data-testid="`member-${member.email}`">
          <div class="min-w-0">
            <p class="truncate font-medium text-default">{{ member.displayName || member.email }}</p>
            <p class="truncate text-sm text-muted">{{ member.email }}</p>
          </div>
          <div class="flex items-center gap-2">
            <ZBadge :status="member.role === 'OWNER' ? 'info' : 'neutral'">{{ member.role === 'OWNER' ? 'Chủ quán' : 'Nhân viên' }}</ZBadge>
            <ZBadge v-if="member.status === 'DISABLED'" status="error">Đã khóa</ZBadge>
            <ZButton v-if="member.canDisable && member.status === 'ACTIVE'" variant="secondary" size="sm" :disabled="mutationPending" @click="emit('setStatus', member, 'DISABLED')">
              Khóa
            </ZButton>
            <ZButton v-if="member.canDisable && member.status === 'DISABLED'" variant="secondary" size="sm" :disabled="mutationPending" @click="emit('setStatus', member, 'ACTIVE')">
              Mở lại
            </ZButton>
          </div>
        </li>
      </ul>
    </ZCard>

    <ZCard v-if="team.invitations.length" title="Lời mời đang chờ" padding="lg">
      <ul class="flex flex-col divide-y divide-(--zeno-border)">
        <li v-for="invitation in team.invitations" :key="invitation.id" class="flex flex-wrap items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="truncate font-medium text-default">{{ invitation.email }}</p>
            <p class="text-sm text-muted">{{ invitation.expired ? 'Đã hết hạn' : `Hết hạn ${formatDateTime(invitation.expiresAt)}` }}</p>
          </div>
          <ZButton variant="ghost" size="sm" :disabled="mutationPending" @click="emit('revoke', invitation.id)">
            Thu hồi
          </ZButton>
        </li>
      </ul>
    </ZCard>
  </div>
</template>
