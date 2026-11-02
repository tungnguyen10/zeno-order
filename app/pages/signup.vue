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
const route = useRoute()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMessage.value = null
  try {
    await signUp(event.data.name, event.data.email, event.data.password)
    await navigateTo(afterSignUpTarget(route.query.redirect))
  }
  catch (err) {
    errorMessage.value = err instanceof AuthFailure ? err.message : 'Đăng ký thất bại, vui lòng thử lại'
  }
  finally {
    loading.value = false
  }
}

const strength = computed(() => passwordStrength(state.password ?? ''))
const strengthBar: Record<number, string> = {
  1: 'bg-red-600',
  2: 'bg-amber-500',
  3: 'bg-emerald-500',
  4: 'bg-emerald-600',
}
</script>

<template>
  <AppAuthShell title="Tạo tài khoản chủ quán" description="Miễn phí khi bắt đầu, thiết lập trong vài phút.">
    <UForm :schema="schema" :state="state" class="flex flex-col gap-5" @submit="onSubmit">
      <ZAlert v-if="errorMessage" color="error" :title="errorMessage" />
      <ZFormField label="Tên của bạn" name="name">
        <ZInput v-model="state.name" autocomplete="name" size="lg" />
      </ZFormField>
      <ZFormField label="Email" name="email">
        <ZInput v-model="state.email" type="email" autocomplete="email" inputmode="email" size="lg" />
      </ZFormField>
      <div class="flex flex-col gap-2">
        <ZFormField label="Mật khẩu" name="password" hint="Ít nhất 8 ký tự">
          <ZInput v-model="state.password" type="password" autocomplete="new-password" size="lg" />
        </ZFormField>
        <div v-if="strength.level > 0" class="flex items-center gap-3">
          <div class="flex flex-1 gap-1" aria-hidden="true">
            <span
              v-for="i in 4"
              :key="i"
              class="h-1.5 flex-1 rounded-full transition-colors"
              :class="i <= strength.level ? strengthBar[strength.level] : 'bg-(--zeno-surface-inset)'"
            />
          </div>
          <span class="text-[13px] font-medium text-muted" aria-live="polite">Độ mạnh: {{ strength.label }}</span>
        </div>
      </div>
      <ZButton type="submit" size="lg" block :loading="loading">
        Tạo tài khoản
      </ZButton>
    </UForm>
    <template #footer>
      Đã có tài khoản?
      <NuxtLink :to="{ path: '/login', query: typeof route.query.redirect === 'string' ? { redirect: route.query.redirect } : {} }" class="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline-offset-4 hover:underline">
        Đăng nhập
      </NuxtLink>
    </template>
  </AppAuthShell>
</template>
