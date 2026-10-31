<script setup lang="ts">
type Color = 'info' | 'success' | 'warning' | 'error'

const props = withDefaults(defineProps<{
  color?: Color
  title?: string
  description?: string
  icon?: string
}>(), { color: 'info' })

const slots = defineSlots<{ description?: () => unknown, actions?: () => unknown }>()

const tones: Record<Color, string> = {
  info: 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-100 dark:ring-indigo-400/25',
  success: 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-100 dark:ring-emerald-400/25',
  warning: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-400/25',
  error: 'bg-red-50 text-red-900 ring-1 ring-red-200 dark:bg-red-400/10 dark:text-red-100 dark:ring-red-400/25',
}

const icons: Record<Color, string> = {
  info: 'i-lucide-info',
  success: 'i-lucide-circle-check',
  warning: 'i-lucide-triangle-alert',
  error: 'i-lucide-circle-alert',
}

const role = computed(() => (props.color === 'error' || props.color === 'warning' ? 'alert' : 'status'))
const ui = computed(() => ({
  root: `rounded-md p-4 gap-3 ${tones[props.color]}`,
  title: 'text-sm font-semibold',
  description: 'mt-0.5 text-sm opacity-100',
  icon: 'size-5 shrink-0',
  actions: 'mt-3',
}))
</script>

<template>
  <UAlert color="neutral" variant="outline" :title="title" :description="description" :icon="icon ?? icons[color]" :role="role" :ui="ui">
    <template v-if="slots.description" #description>
      <slot name="description" />
    </template>
    <template v-if="slots.actions" #actions>
      <slot name="actions" />
    </template>
  </UAlert>
</template>
