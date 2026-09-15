<script setup lang="ts">
import type { StorefrontCatalog } from '../../../shared/types/catalog'

defineProps<{
  sections: StorefrontCatalog['sections']
}>()
</script>

<template>
  <nav
    aria-label="Danh mục thực đơn"
    class="no-scrollbar sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto border-y border-[rgb(var(--border))] bg-[rgb(var(--background)/0.94)] px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border"
  >
    <a
      v-for="section in sections"
      :key="section.id"
      :href="`#${section.slug}`"
      class="shrink-0 rounded-full bg-[rgb(var(--surface))] px-4 py-2 text-sm font-bold shadow-sm ring-1 ring-[rgb(var(--border))] transition hover:text-[rgb(var(--brand))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--brand))]"
    >
      {{ section.name }}
    </a>
  </nav>
</template>
