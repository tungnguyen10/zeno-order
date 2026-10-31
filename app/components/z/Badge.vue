<script setup lang="ts">
type Status = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const props = withDefaults(defineProps<{
  status?: Status
  size?: 'sm' | 'md'
  icon?: string
}>(), { status: 'neutral', size: 'md' })

const tones: Record<Status, string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200',
  info: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-200',
  neutral: 'bg-(--zeno-surface-inset) text-(--zeno-text-muted)',
}

const classes = computed(() => [
  'rounded-full font-medium ring-0',
  props.size === 'sm' ? 'px-2 py-0.5 text-xs gap-1' : 'px-2.5 py-1 text-[13px] gap-1.5',
  tones[props.status],
])
</script>

<template>
  <UBadge color="neutral" variant="soft" :icon="icon" :class="classes">
    <slot />
  </UBadge>
</template>
