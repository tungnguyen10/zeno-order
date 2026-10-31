<script setup lang="ts">
const model = defineModel<string | undefined>()

const props = withDefaults(defineProps<{
  items: Array<{ label: string, value: string }>
  placeholder?: string
  size?: 'md' | 'lg'
}>(), { size: 'md' })

const ui = computed(() => ({
  base: [
    'w-full rounded-md bg-(--zeno-surface-inset) text-base text-default shadow-inset ring-0',
    'hover:bg-(--zeno-surface-inset-hover) dark:inset-ring dark:inset-ring-(--zeno-border)',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    props.size === 'lg' ? 'min-h-[52px] ps-4 pe-10' : 'min-h-12 ps-3.5 pe-10',
  ].join(' '),
  value: 'text-base font-medium',
  trailingIcon: 'size-5 text-muted',
  content: 'bg-(--zeno-surface) ring-default',
  item: 'min-h-11 items-center text-base',
}))
</script>

<template>
  <USelect v-model="model" :items="items" :placeholder="placeholder" variant="none" size="lg" :ui="ui" />
</template>
