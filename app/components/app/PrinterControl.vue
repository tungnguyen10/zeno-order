<script setup lang="ts">
import type { PrintMethod } from '~/composables/usePrinter'

const printer = usePrinter()
const open = ref(false)

const methods: { value: PrintMethod, label: string, description: string }[] = [
  { value: 'browser', label: 'Trình duyệt', description: 'In qua hộp thoại in của máy (mọi máy in 58/80mm).' },
  { value: 'bluetooth', label: 'Bluetooth', description: 'In thẳng ra máy in nhiệt Bluetooth (Chrome, HTTPS).' },
]
</script>

<template>
  <div>
    <ZButton variant="ghost" icon="i-lucide-printer" aria-label="Cài đặt in bếp" @click="open = true">
      Máy in
    </ZButton>

    <ZSheet v-model:open="open" title="In bếp" description="Chọn cách in phiếu bếp và bật tự động in khi có đơn mới.">
      <div class="flex flex-col gap-5">
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-medium">Cách in</legend>
          <ZButton
            v-for="item in methods"
            :key="item.value"
            role="radio"
            :aria-checked="printer.method.value === item.value"
            :variant="printer.method.value === item.value ? 'primary' : 'secondary'"
            block
            @click="printer.setMethod(item.value)"
          >
            <span class="flex flex-col items-start text-left">
              <span>{{ item.label }}</span>
              <span class="text-[13px] font-normal opacity-80">{{ item.description }}</span>
            </span>
          </ZButton>
        </fieldset>

        <div v-if="printer.method.value === 'bluetooth'" class="flex flex-col gap-2">
          <ZAlert v-if="!printer.bluetoothSupported" color="warning" title="Trình duyệt này không hỗ trợ in Bluetooth" description="Dùng Chrome trên Android hoặc máy tính, qua HTTPS." />
          <template v-else>
            <ZAlert v-if="printer.connection.value" color="success" :title="`Đã kết nối: ${printer.connection.value.name}`" />
            <ZButton v-if="printer.connection.value" variant="secondary" icon="i-lucide-bluetooth-off" @click="printer.disconnect()">
              Ngắt kết nối
            </ZButton>
            <ZButton v-else icon="i-lucide-bluetooth" :loading="printer.connecting.value" @click="printer.connect()">
              Kết nối máy in Bluetooth
            </ZButton>
            <ZAlert v-if="printer.error.value" color="error" :title="printer.error.value" />
          </template>
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-medium">Khổ giấy</legend>
          <div role="radiogroup" aria-label="Khổ giấy" class="grid grid-cols-2 gap-2">
            <ZButton
              v-for="width in (['58', '80'] as const)"
              :key="width"
              role="radio"
              :aria-checked="printer.paperWidth.value === width"
              :variant="printer.paperWidth.value === width ? 'primary' : 'secondary'"
              @click="printer.setPaperWidth(width)"
            >
              {{ width }}mm
            </ZButton>
          </div>
        </fieldset>

        <ZSwitch
          :model-value="printer.autoPrint.value"
          label="Tự động in khi có đơn mới"
          description="In phiếu bếp ngay khi đơn mới xuất hiện trên board."
          @update:model-value="printer.setAutoPrint($event)"
        />
      </div>
    </ZSheet>
  </div>
</template>
