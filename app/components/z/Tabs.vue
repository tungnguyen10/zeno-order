<script setup lang="ts">
const model = defineModel<string>({ required: true })

defineProps<{
  items: Array<{ label: string, value: string, icon?: string }>
}>()

const ui = {
  root: 'w-full',
  list: 'overflow-x-auto rounded-md bg-(--zeno-surface-inset) p-1 shadow-inset dark:shadow-none dark:ring-1 dark:ring-default',
  indicator: 'rounded-md bg-(--zeno-surface) shadow-raised-sm dark:shadow-none',
  trigger: 'min-h-11 shrink-0 whitespace-nowrap rounded-md px-4 text-base font-medium text-muted data-[state=active]:text-primary focus-visible:outline-2 focus-visible:outline-primary',
}
</script>

<template>
  <UTabs
    :model-value="model"
    :items="items"
    :content="false"
    variant="pill"
    :ui="ui"
    @update:model-value="model = String($event)"
  />
</template>
