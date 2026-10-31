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
  <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
    <h1 class="text-2xl font-semibold">Đăng nhập</h1>
    <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />
    <UForm :schema="schema" :state="state" class="flex flex-col gap-4" @submit="onSubmit">
      <UFormField label="Email" name="email">
        <UInput v-model="state.email" type="email" autocomplete="email" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Mật khẩu" name="password">
        <UInput v-model="state.password" type="password" autocomplete="current-password" size="xl" class="w-full" />
      </UFormField>
      <UButton type="submit" size="xl" block :loading="loading">Đăng nhập</UButton>
    </UForm>
    <p class="text-sm text-muted">
      Chưa có tài khoản?
      <ULink to="/signup" class="inline-flex min-h-11 items-center font-medium text-primary">Đăng ký</ULink>
    </p>
  </main>
</template>
