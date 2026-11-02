<script setup lang="ts">
import type { CreatedInvitation } from '#shared/types/team'

defineProps<{ inviting: boolean, formError: string | null, created: CreatedInvitation | null }>()
const email = defineModel<string>({ required: true })
const emit = defineEmits<{ invite: [], dismiss: [] }>()
</script>

<template>
  <ZCard title="Mời nhân viên" description="Tạo link rồi tự gửi qua Zalo hoặc tin nhắn. Nhân viên cần đăng nhập bằng đúng email này." padding="lg">
    <form class="flex flex-col gap-4" @submit.prevent="emit('invite')">
      <ZFormField label="Email nhân viên" name="email">
        <ZInput v-model="email" type="email" size="lg" inputmode="email" autocomplete="off" placeholder="nhanvien@gmail.com" />
      </ZFormField>
      <ZAlert v-if="formError" color="error" :title="formError" />
      <ZButton type="submit" size="lg" block :loading="inviting" :disabled="!email">
        Tạo lời mời
      </ZButton>
    </form>

    <div v-if="created" class="mt-5 flex flex-col gap-3 border-t border-default pt-5" data-testid="invite-result">
      <ZAlert color="success" title="Đã tạo lời mời" :description="`Link chỉ hiện một lần và hết hạn sau 7 ngày. Gửi cho ${created.invitation.email}.`" />
      <AppCopyField :value="created.inviteUrl" label="Link lời mời" />
      <ZButton variant="ghost" @click="emit('dismiss')">
        Xong, ẩn link
      </ZButton>
    </div>
  </ZCard>

</template>
