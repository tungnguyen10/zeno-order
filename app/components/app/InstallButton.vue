<script setup lang="ts">
const install = useInstallPrompt()
const showIosHint = ref(false)

async function onInstall() {
  await install.install()
}
</script>

<template>
  <div v-if="install.canPrompt.value || install.showIosHint.value">
    <ZButton
      v-if="install.canPrompt.value"
      variant="secondary"
      block
      icon="i-lucide-download"
      @click="onInstall"
    >
      Cài đặt ứng dụng
    </ZButton>

    <template v-else>
      <ZButton variant="secondary" block icon="i-lucide-share" @click="showIosHint = !showIosHint">
        Cài đặt ứng dụng
      </ZButton>
      <p v-if="showIosHint" class="mt-2 text-[13px] text-muted">
        Trên iPhone: bấm nút Chia sẻ <span aria-hidden="true">⬆️</span> rồi chọn
        <span class="font-medium text-default">“Thêm vào MH chính”</span>.
      </p>
    </template>
  </div>
</template>
