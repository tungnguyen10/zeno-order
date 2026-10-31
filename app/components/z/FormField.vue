<script setup lang="ts">
defineProps<{
  label?: string
  name?: string
  hint?: string
  help?: string
  description?: string
  required?: boolean
}>()

const slots = defineSlots<{ default?: () => unknown, help?: () => unknown, hint?: () => unknown }>()

const ui = {
  root: 'w-full',
  labelWrapper: 'mb-1.5 flex items-baseline justify-between gap-2',
  label: 'block text-sm font-medium text-default',
  hint: 'text-[13px] text-muted',
  description: 'text-[13px] text-muted',
  help: 'mt-1.5 text-[13px] text-muted',
  error: 'mt-1.5 text-[13px] font-medium text-error',
}
</script>

<template>
  <UFormField :label="label" :name="name" :hint="hint" :help="help" :description="description" :required="required" :ui="ui">
    <slot />
    <template v-if="slots.help" #help>
      <slot name="help" />
    </template>
    <template v-if="slots.hint" #hint>
      <slot name="hint" />
    </template>
  </UFormField>
</template>
