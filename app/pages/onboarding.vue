<script setup lang="ts">
import type { Form, FormSubmitEvent } from '@nuxt/ui'
import { onboardingInputSchema, slugify, type OnboardingInput } from '#shared/schemas/identity'

definePageMeta({ middleware: ['auth'] })
useHead({ title: 'Tạo cửa hàng' })

const { load } = useMe()
const existing = await load()
if (existing.stores.length > 0) await navigateTo('/app/orders', { replace: true })

const config = useRuntimeConfig()
const api = useApi()
const toast = useToast()
const form = useTemplateRef<Form<OnboardingInput>>('form')

const state = reactive<Partial<OnboardingInput>>({ orgName: '', storeName: '', storeSlug: '' })
const slugTouched = ref(false)
const loading = ref(false)

watch(() => state.storeName, (name) => {
  if (!slugTouched.value) state.storeSlug = slugify(name ?? '')
})

const previewUrl = computed(() => `${config.public.appBaseUrl}/s/${state.storeSlug || '...'}`)

async function onSubmit(event: FormSubmitEvent<OnboardingInput>) {
  loading.value = true
  try {
    await api('/api/organizations', { method: 'POST', body: event.data })
    await load(true)
    await navigateTo('/app/orders')
  }
  catch (err) {
    const apiError = extractApiError(err)
    if (apiError.code === 'SLUG_TAKEN') {
      form.value?.setErrors([{ name: 'storeSlug', message: apiError.message }])
    }
    else if (apiError.code === 'ORG_EXISTS') {
      await load(true)
      await navigateTo('/app/orders')
    }
    else {
      toast.add({ color: 'error', title: apiError.message })
    }
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
    <div>
      <h1 class="text-2xl font-semibold">Tạo cửa hàng đầu tiên</h1>
      <p class="mt-1 text-sm text-muted">Bạn có thể thêm món, bàn và thanh toán ở bước sau.</p>
    </div>
    <UForm ref="form" :schema="onboardingInputSchema" :state="state" class="flex flex-col gap-4" @submit="onSubmit">
      <UFormField label="Tên doanh nghiệp" name="orgName" hint="Ví dụ: tên chủ quán hoặc chuỗi">
        <UInput v-model="state.orgName" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Tên cửa hàng" name="storeName">
        <UInput v-model="state.storeName" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Đường dẫn cửa hàng" name="storeSlug" :help="previewUrl">
        <UInput v-model="state.storeSlug" size="xl" class="w-full" autocapitalize="off" @input="slugTouched = true" />
      </UFormField>
      <UButton type="submit" size="xl" block :loading="loading">Tạo cửa hàng</UButton>
    </UForm>
  </main>
</template>
