<script setup lang="ts">
interface TurnstileApi {
  render: (element: HTMLElement, options: {
    sitekey: string
    theme: 'light'
    callback: (token: string) => void
    'expired-callback': () => void
    'error-callback': () => void
  }) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{ verified: [token: string] }>()
const container = useTemplateRef<HTMLElement>('container')
const loadError = shallowRef(false)
let widgetId: string | null = null

function renderWidget() {
  if (!container.value || !window.turnstile || widgetId) return
  widgetId = window.turnstile.render(container.value, {
    sitekey: props.siteKey,
    theme: 'light',
    callback: token => emit('verified', token),
    'expired-callback': () => emit('verified', ''),
    'error-callback': () => {
      loadError.value = true
      emit('verified', '')
    },
  })
}

onMounted(() => {
  if (!props.siteKey) {
    loadError.value = true
    return
  }
  if (window.turnstile) {
    renderWidget()
    return
  }

  const existing = document.querySelector<HTMLScriptElement>('script[data-zeno-turnstile]')
  const script = existing ?? document.createElement('script')
  script.addEventListener('load', renderWidget, { once: true })
  script.addEventListener('error', () => { loadError.value = true }, { once: true })
  if (!existing) {
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.zenoTurnstile = 'true'
    document.head.append(script)
  }
})

onBeforeUnmount(() => {
  if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
})
</script>

<template>
  <div>
    <div
      ref="container"
      data-turnstile
      aria-label="Xác minh chống bot"
    />
    <p
      v-if="loadError"
      role="alert"
      class="mt-2 text-sm font-semibold text-[rgb(var(--danger))]"
    >
      Chưa thể tải bước xác minh. Vui lòng tải lại trang.
    </p>
  </div>
</template>
