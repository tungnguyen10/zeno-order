<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

useHead({ title: 'Đăng nhập' })

const schema = z.object({
  email: z.email('Email không hợp lệ'),
  password: z.string().min(1, 'Nhập mật khẩu'),
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({ email: '', password: '' })
const errorMessage = ref<string | null>(null)
const loading = ref(false)
const route = useRoute()
const { signIn } = useAuth()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMessage.value = null
  try {
    await signIn(event.data.email, event.data.password)
    await navigateTo(safeRedirect(route.query.redirect))
  }
  catch (err) {
    errorMessage.value = err instanceof AuthFailure ? err.message : 'Đăng nhập thất bại, vui lòng thử lại'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AppAuthShell title="Đăng nhập" description="Quản lý đơn và menu của quán bạn.">
    <UForm :schema="schema" :state="state" class="flex flex-col gap-5" @submit="onSubmit">
      <ZAlert v-if="errorMessage" color="error" :title="errorMessage" />
      <ZFormField label="Email" name="email">
        <ZInput v-model="state.email" type="email" autocomplete="email" inputmode="email" size="lg" />
      </ZFormField>
      <ZFormField label="Mật khẩu" name="password">
        <ZInput v-model="state.password" type="password" autocomplete="current-password" size="lg" />
      </ZFormField>
      <ZButton type="submit" size="lg" block :loading="loading">
        Đăng nhập
      </ZButton>
    </UForm>
    <template #footer>
      Chưa có tài khoản?
      <NuxtLink to="/signup" class="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline-offset-4 hover:underline">
        Đăng ký
      </NuxtLink>
    </template>
  </AppAuthShell>
</template>
