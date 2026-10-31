<script setup lang="ts">
withDefaults(defineProps<{
  icon: string
  title: string
  description?: string
  headingLevel?: 'h1' | 'h2'
}>(), { headingLevel: 'h2' })

const slots = defineSlots<{ actions?: () => unknown }>()
</script>

<template>
  <section class="flex flex-col items-center gap-4 px-2 py-8 text-center sm:py-12">
    <div class="flex size-20 items-center justify-center rounded-full bg-(--zeno-surface-inset) shadow-inset dark:shadow-none">
      <UIcon :name="icon" class="size-9 text-primary" />
    </div>
    <component :is="headingLevel" class="text-h3 text-default">
      {{ title }}
    </component>
    <p v-if="description" class="max-w-xs text-muted">
      {{ description }}
    </p>
    <div v-if="slots.actions" class="mt-2 flex w-full max-w-sm flex-col gap-3 text-start">
      <slot name="actions" />
    </div>
  </section>
</template>
