<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  title: string
  description?: string
}>()

const slots = defineSlots<{
  default?: () => unknown
  footer?: () => unknown
}>()

const ui = computed(() => ({
  content: 'bg-(--zeno-surface) max-h-[92dvh] rounded-t-lg ring-1 ring-default',
  container: 'mx-auto flex min-h-0 w-full max-w-lg flex-col',
  header: 'border-b border-default px-4 pb-3 pt-2',
  title: 'text-h3 text-default',
  description: props.description ? 'mt-1 text-sm text-muted' : 'sr-only',
  body: 'min-h-0 flex-1 overflow-y-auto px-4 py-4',
  footer: 'border-t border-default px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3',
}))
</script>

<template>
  <UDrawer v-model:open="open" :title="title" :description="description ?? title" :ui="ui">
    <template #body>
      <slot />
    </template>
    <template v-if="slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UDrawer>
</template>
