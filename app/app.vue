<script setup lang="ts">
const colorMode = useColorMode()

useHead({
  meta: [{ name: 'theme-color', content: () => (colorMode.value === 'dark' ? '#1c1410' : '#fdf6ec') }],
})
</script>

<template>
  <UApp :toaster="{ position: 'top-center' }">
    <NuxtLoadingIndicator color="var(--ui-primary)" :height="3" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
