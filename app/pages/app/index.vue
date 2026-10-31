<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'has-store', () => navigateTo('/app/orders', { replace: true })],
})
</script>

<template>
  <div />
</template>
