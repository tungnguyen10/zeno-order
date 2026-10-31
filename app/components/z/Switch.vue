<script setup lang="ts">
const model = defineModel<boolean>({ default: false })

defineProps<{ label?: string, description?: string, disabled?: boolean }>()

// The label row is 44px tall and an invisible ::before pad grows the toggle's own hit area to ≥44px.
const ui = {
  root: 'min-h-11 items-center gap-1',
  base: "relative before:absolute before:-inset-4 before:content-[''] data-[state=checked]:bg-primary data-[state=unchecked]:bg-(--zeno-surface-inset) dark:data-[state=unchecked]:bg-(--zeno-border)",
  wrapper: 'ms-3',
  label: 'flex min-h-11 items-center text-base font-medium text-default',
  description: '-mt-2 text-[13px] text-muted',
}
</script>

<template>
  <USwitch v-model="model" :label="label" :description="description" :disabled="disabled" size="lg" :ui="ui" />
</template>
