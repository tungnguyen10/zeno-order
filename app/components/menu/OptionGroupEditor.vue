<script setup lang="ts">
import { PRESET_LABELS, rulesOf, type EditableGroup, type GroupPreset } from '#shared/option-presets'

const group = defineModel<EditableGroup>({ required: true })
defineEmits<{ remove: [] }>()

const presetItems = (Object.keys(PRESET_LABELS) as GroupPreset[]).map(value => ({ label: PRESET_LABELS[value], value }))
const presetModel = computed({
  get: () => group.value.preset,
  set: (value: GroupPreset) => {
    group.value.preset = value
    group.value.presetChanged = true
  },
})
const preservedRules = computed(() => {
  const current = group.value
  if (!current.originalRules || current.presetChanged || current.preset !== current.originalPreset) return null
  const standard = rulesOf(current.preset, current.values.filter(value => value.name.trim()).length)
  const original = current.originalRules
  return original.required !== standard.required || original.minSelect !== standard.minSelect || original.maxSelect !== standard.maxSelect
    ? original
    : null
})

function addValue() {
  group.value.values.push({ key: crypto.randomUUID(), name: '', priceRaw: '', active: true })
}

function removeValue(key: string) {
  group.value.values = group.value.values.filter(value => value.key !== key)
}
</script>

<template>
  <fieldset class="flex flex-col gap-3 rounded-md p-4 ring-1 ring-default">
    <legend class="sr-only">
      Nhóm option {{ group.name }}
    </legend>
    <div class="flex items-end gap-2">
      <ZFormField label="Tên nhóm" class="flex-1">
        <ZInput v-model="group.name" placeholder="Ví dụ: Size" autocomplete="off" />
      </ZFormField>
      <ZButton variant="ghost" square icon="i-lucide-trash-2" aria-label="Xoá nhóm option" @click="$emit('remove')" />
    </div>
    <ZFormField label="Cách chọn">
      <ZSelect v-model="presetModel" :items="presetItems" aria-label="Cách chọn" />
    </ZFormField>
    <p v-if="preservedRules" class="text-sm text-muted">
      Đang giữ quy tắc đã lưu: tối thiểu {{ preservedRules.minSelect }}, tối đa {{ preservedRules.maxSelect }} lựa chọn{{ preservedRules.required ? ', bắt buộc' : '' }}. Đổi cách chọn để áp dụng mẫu mới.
    </p>

    <ul class="flex flex-col gap-3">
      <li v-for="value in group.values" :key="value.key" class="flex flex-col gap-2 rounded-md bg-(--zeno-surface-inset) p-3">
        <div class="flex items-center gap-2">
          <ZInput v-model="value.name" aria-label="Tên lựa chọn" placeholder="Ví dụ: M" autocomplete="off" class="flex-1" />
          <ZInput v-model="value.priceRaw" aria-label="Giá cộng thêm" inputmode="numeric" placeholder="+0đ" autocomplete="off" class="w-28" />
          <ZButton variant="ghost" square icon="i-lucide-x" aria-label="Xoá lựa chọn" @click="removeValue(value.key)" />
        </div>
        <ZSwitch v-model="value.active" label="Đang bán" />
      </li>
    </ul>
    <ZButton variant="secondary" icon="i-lucide-plus" @click="addValue">
      Thêm lựa chọn
    </ZButton>
  </fieldset>
</template>
