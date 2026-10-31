<script setup lang="ts">
const props = withDefaults(defineProps<{
  variant?: 'raised' | 'elevated' | 'flat'
  padding?: 'md' | 'lg'
  title?: string
  description?: string
}>(), { variant: 'raised', padding: 'lg' })

const slots = defineSlots<{ default?: () => unknown, header?: () => unknown, footer?: () => unknown }>()

const surfaces = {
  raised: 'shadow-raised dark:ring-1 dark:ring-default',
  elevated: 'shadow-md dark:ring-1 dark:ring-default',
  flat: 'ring-1 ring-default',
}

const ui = computed(() => {
  const pad = props.padding === 'lg' ? 'p-4 sm:p-6' : 'p-4'
  return {
    root: `rounded-md bg-(--zeno-surface) overflow-visible divide-y-0 ${surfaces[props.variant]}`,
    header: `${pad} pb-0 sm:pb-0`,
    title: '',
    description: 'mt-1 text-sm text-muted',
    body: pad,
    footer: `${pad} pt-0 sm:pt-0`,
  }
})
</script>

<template>
  <UCard :title="title" :description="description" :ui="ui">
    <template v-if="slots.header" #header>
      <slot name="header" />
    </template>
    <template v-if="title" #title>
      <h2 class="text-h3 text-default">
        {{ title }}
      </h2>
    </template>
    <slot />
    <template v-if="slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
