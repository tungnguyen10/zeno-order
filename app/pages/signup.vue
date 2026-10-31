<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

useHead({ title: 'Tạo tài khoản' })

const schema = z.object({
  name: z.string().trim().min(2, 'Cần ít nhất 2 ký tự').max(80),
  email: z.email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự'),
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({ name: '', email: '', password: '' })
const errorMessage = ref<string | null>(null)
const loading = ref(false)
const { signUp } = useAuth()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMessage.value = null
  try {
    await signUp(event.data.name, event.data.email, event.data.password)
    await navigateTo('/onboarding')
  }
  catch (err) {
    errorMessage.value = err instanceof AuthFailure ? err.message : 'Đăng ký thất bại, vui lòng thử lại'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
    <h1 class="text-2xl font-semibold">Tạo tài khoản chủ quán</h1>
    <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />
    <UForm :schema="schema" :state="state" class="flex flex-col gap-4" @submit="onSubmit">
      <UFormField label="Tên của bạn" name="name">
        <UInput v-model="state.name" autocomplete="name" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Email" name="email">
        <UInput v-model="state.email" type="email" autocomplete="email" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Mật khẩu" name="password" hint="Ít nhất 8 ký tự">
        <UInput v-model="state.password" type="password" autocomplete="new-password" size="xl" class="w-full" />
      </UFormField>
      <UButton type="submit" size="xl" block :loading="loading">Tạo tài khoản</UButton>
    </UForm>
    <p class="text-sm text-muted">
      Đã có tài khoản?
      <ULink to="/login" class="inline-flex min-h-11 items-center font-medium text-primary">Đăng nhập</ULink>
    </p>
  </main>
</template>
