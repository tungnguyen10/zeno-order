<script setup lang="ts">
defineProps<{ title: string, description?: string }>()
const slots = defineSlots<{ actions?: () => unknown }>()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-h2 text-default">
        {{ title }}
      </h1>
      <p v-if="description" class="mt-1 text-sm text-muted">
        {{ description }}
      </p>
    </div>
    <div v-if="slots.actions" class="flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
