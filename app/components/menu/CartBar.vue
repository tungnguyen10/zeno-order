<script setup lang="ts">
import { formatVnd } from '#shared/money'
defineProps<{ count: number, totalVnd: number }>()
</script>

<template>
  <div v-if="count > 0" class="fixed inset-x-0 bottom-0 z-20 border-t border-default bg-default/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur" aria-live="polite">
    <div class="mx-auto flex max-w-2xl items-center justify-between gap-3">
      <span class="font-medium text-default">Giỏ • {{ count }} món</span><span class="font-mono text-lg text-default">{{ formatVnd(totalVnd) }}</span>
    </div>
  </div>
</template>
