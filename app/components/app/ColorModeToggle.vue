<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'icon' | 'row' }>(), { variant: 'icon' })

const colorMode = useColorMode()
const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (dark: boolean) => { colorMode.preference = dark ? 'dark' : 'light' },
})
</script>

<template>
  <ClientOnly>
    <ZButton
      v-if="variant === 'icon'"
      variant="ghost"
      square
      :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
      :aria-label="isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'"
      @click="isDark = !isDark"
    />
    <ZSwitch v-else v-model="isDark" label="Giao diện tối" />
    <template #fallback>
      <span :class="variant === 'icon' ? 'inline-block size-11' : 'block h-11'" aria-hidden="true" />
    </template>
  </ClientOnly>
</template>
