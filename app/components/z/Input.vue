<script setup lang="ts">
const model = defineModel<string | number | null | undefined>()

const props = withDefaults(defineProps<{
  type?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'search' | 'number'
  size?: 'md' | 'lg'
  icon?: string
  placeholder?: string
  autocomplete?: string
  readonly?: boolean
  disabled?: boolean
}>(), { type: 'text', size: 'md' })

const slots = defineSlots<{ leading?: () => unknown, trailing?: () => unknown }>()

const revealed = ref(false)
const isPassword = computed(() => props.type === 'password')
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))

const ui = computed(() => ({
  root: 'w-full',
  base: [
    'rounded-md border-0 bg-(--zeno-surface-inset) text-base text-default placeholder:text-dimmed shadow-inset',
    'hover:bg-(--zeno-surface-inset-hover) dark:inset-ring dark:inset-ring-(--zeno-border)',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    'aria-invalid:ring-2 aria-invalid:ring-error aria-invalid:bg-(--zeno-error-wash) aria-invalid:shadow-none',
    'disabled:bg-(--zeno-surface-disabled) disabled:opacity-100 disabled:text-muted disabled:shadow-none',
    props.size === 'lg' ? 'min-h-[52px] px-4' : 'min-h-12 px-3.5',
    isPassword.value ? 'pe-12' : '',
  ].join(' '),
  leadingIcon: 'size-5 text-muted',
  trailing: 'pe-1',
}))
</script>

<template>
  <UInput
    v-model="model"
    :type="inputType"
    :icon="icon"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :readonly="readonly"
    :disabled="disabled"
    variant="none"
    size="lg"
    :ui="ui"
  >
    <template v-if="slots.leading" #leading>
      <slot name="leading" />
    </template>
    <template v-if="isPassword || slots.trailing" #trailing>
      <slot name="trailing">
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-md text-muted hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="revealed ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
          :aria-pressed="revealed"
          @click="revealed = !revealed"
        >
          <UIcon :name="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-5" />
        </button>
      </slot>
    </template>
  </UInput>
</template>
