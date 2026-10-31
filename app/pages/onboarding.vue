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
  <AppAuthShell
    title="Tạo cửa hàng đầu tiên"
    description="Bạn có thể thêm món, bàn và thanh toán ở bước sau."
    :step="{ current: 2, total: 2, label: 'Tạo cửa hàng' }"
  >
    <UForm ref="form" :schema="onboardingInputSchema" :state="state" class="flex flex-col gap-6" @submit="onSubmit">
      <fieldset class="flex flex-col gap-4">
        <legend class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Doanh nghiệp
        </legend>
        <ZFormField label="Tên doanh nghiệp" name="orgName" help="Ví dụ: tên chủ quán hoặc tên chuỗi">
          <ZInput v-model="state.orgName" autocomplete="organization" size="lg" />
        </ZFormField>
      </fieldset>
      <fieldset class="flex flex-col gap-4">
        <legend class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Cửa hàng
        </legend>
        <ZFormField label="Tên cửa hàng" name="storeName">
          <ZInput v-model="state.storeName" size="lg" />
        </ZFormField>
        <ZFormField label="Đường dẫn cửa hàng" name="storeSlug">
          <ZInput
            v-model="state.storeSlug"
            size="lg"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            @input="slugTouched = true"
          >
            <template #leading>
              <span class="font-mono text-sm text-muted">/s/</span>
            </template>
          </ZInput>
          <template #help>
            <span class="break-all font-mono">{{ previewUrl }}</span>
          </template>
        </ZFormField>
      </fieldset>
      <ZButton type="submit" size="lg" block :loading="loading">
        Tạo cửa hàng
      </ZButton>
    </UForm>
  </AppAuthShell>
</template>
