<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  type?: 'button' | 'submit' | 'reset'
  to?: RouteLocationRaw
  target?: '_blank' | '_self'
  icon?: string
  trailingIcon?: string
  loading?: boolean
  disabled?: boolean
  block?: boolean
  square?: boolean
}>(), { variant: 'primary', size: 'md', type: 'button' })

const variants = {
  primary: {
    color: 'primary',
    variant: 'solid',
    class: 'bg-primary text-(--zeno-on-primary) hover:bg-(--zeno-primary-hover) shadow-raised-sm active:shadow-none dark:shadow-none',
  },
  secondary: {
    color: 'primary',
    variant: 'soft',
    class: 'bg-(--zeno-surface-hover) text-primary hover:bg-(--zeno-surface-inset) shadow-raised-sm active:shadow-none dark:shadow-none dark:ring-1 dark:ring-default',
  },
  ghost: {
    color: 'neutral',
    variant: 'ghost',
    class: 'text-(--zeno-text-muted) hover:bg-(--zeno-surface-hover) hover:text-default',
  },
  destructive: {
    color: 'error',
    variant: 'solid',
    class: 'bg-error text-white hover:bg-red-800 dark:text-(--zeno-on-primary) dark:hover:bg-red-300',
  },
} as const

// `sm` is 36px tall; the ::before pad extends its hit area to 44px.
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3.5 text-sm gap-1.5 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
  md: 'min-h-11 px-[18px] text-base gap-2',
  lg: 'min-h-[50px] px-6 text-base font-semibold gap-2',
}

const classes = computed(() => [
  'relative rounded-md font-medium justify-center transition-[background-color,box-shadow,color] duration-150',
  'disabled:opacity-40 aria-disabled:opacity-40 disabled:shadow-none aria-disabled:shadow-none',
  props.square ? 'px-0 min-w-11' : '',
  sizes[props.size],
  variants[props.variant].class,
])
</script>

<template>
  <UButton
    :to="to"
    :target="target"
    :type="type"
    :icon="icon"
    :trailing-icon="trailingIcon"
    :loading="loading"
    :disabled="disabled"
    :block="block"
    :square="square"
    :color="variants[variant].color"
    :variant="variants[variant].variant"
    :class="classes"
    :aria-busy="loading || undefined"
  >
    <slot />
  </UButton>
</template>
