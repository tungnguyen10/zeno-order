<script setup lang="ts">
const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'mark'
  to?: string
}>(), { size: 'md', variant: 'full' })

const sizes = {
  sm: { mark: 'size-7', text: 'text-lg' },
  md: { mark: 'size-8', text: 'text-xl' },
  lg: { mark: 'size-10', text: 'text-2xl' },
}

const NuxtLink = resolveComponent('NuxtLink')
const tag = computed(() => (props.to ? NuxtLink : 'span'))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :aria-label="to ? 'ZENO — Trang chủ' : undefined"
    class="inline-flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  >
    <svg :class="sizes[size].mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" class="fill-primary" />
      <path d="M17 27h24v9a12 12 0 0 1-12 12h0a12 12 0 0 1-12-12z" class="fill-(--zeno-bg)" />
      <path d="M41 30h3a5.5 5.5 0 0 1 0 11h-3.5" fill="none" stroke-width="3.5" stroke-linecap="round" class="stroke-(--zeno-bg)" />
      <path d="M24 13c-2.5 2.8 2.5 5.2 0 8.5M32 13c-2.5 2.8 2.5 5.2 0 8.5" fill="none" stroke-width="3" stroke-linecap="round" class="stroke-coffee-200" />
    </svg>
    <span v-if="variant === 'full'" :class="sizes[size].text" class="font-display font-semibold tracking-tight text-default">zeno</span>
  </component>
</template>
