<script setup lang="ts">
import { formatVnd } from '#shared/money'

const props = defineProps<{ slug: string }>()
const emit = defineEmits<{ open: [] }>()

const cart = useCart(props.slug)
</script>

<template>
  <div
    v-if="cart.ready.value && cart.count.value > 0"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
  >
    <ZButton
      block
      size="lg"
      icon="i-lucide-shopping-bag"
      class="pointer-events-auto mx-auto max-w-2xl justify-between"
      data-testid="cart-bar"
      :aria-label="`Xem giỏ hàng, ${cart.count.value} món, ${formatVnd(cart.subtotalVnd.value)}`"
      @click="emit('open')"
    >
      <span>Giỏ • {{ cart.count.value }} món</span>
      <span class="font-mono">{{ formatVnd(cart.subtotalVnd.value) }}</span>
    </ZButton>
  </div>
</template>
