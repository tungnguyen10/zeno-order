import { parseVndInput } from './money'
import { vndSchema } from './schemas/common'
import type { OptionGroupDTO } from './types/catalog'

export type GroupPreset = 'single-required' | 'single-optional' | 'multi'

export const PRESET_LABELS: Record<GroupPreset, string> = {
  'single-required': 'Chọn 1 (bắt buộc)',
  'single-optional': 'Chọn 1 (tuỳ chọn)',
  multi: 'Chọn nhiều (tuỳ chọn)',
}

export interface EditableValue {
  key: string
  name: string
  priceRaw: string
  active: boolean
}

export interface EditableGroup {
  key: string
  name: string
  preset: GroupPreset
  values: EditableValue[]
}

export interface OptionsPayloadGroup {
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  values: { name: string, priceDeltaVnd: number, active: boolean }[]
}

export function presetOf(group: { required: boolean, maxSelect: number }): GroupPreset {
  if (group.maxSelect > 1) return 'multi'
  return group.required ? 'single-required' : 'single-optional'
}

export function rulesOf(preset: GroupPreset, valueCount: number): { required: boolean, minSelect: number, maxSelect: number } {
  switch (preset) {
    case 'single-required': return { required: true, minSelect: 1, maxSelect: 1 }
    case 'single-optional': return { required: false, minSelect: 0, maxSelect: 1 }
    case 'multi': return { required: false, minSelect: 0, maxSelect: Math.max(valueCount, 2) }
  }
}

export function toEditableGroups(groups: OptionGroupDTO[], makeKey: () => string): EditableGroup[] {
  return groups.map(group => ({
    key: makeKey(),
    name: group.name,
    preset: presetOf(group),
    values: group.values.map(value => ({
      key: makeKey(),
      name: value.name,
      priceRaw: value.priceDeltaVnd > 0 ? String(value.priceDeltaVnd) : '',
      active: value.active,
    })),
  }))
}

export function buildOptionsPayload(groups: EditableGroup[]): { ok: true, groups: OptionsPayloadGroup[] } | { ok: false, error: string } {
  const payload: OptionsPayloadGroup[] = []
  for (const group of groups) {
    const name = group.name.trim()
    if (!name) return { ok: false, error: 'Nhóm option cần có tên' }

    const values: OptionsPayloadGroup['values'] = []
    for (const value of group.values) {
      const valueName = value.name.trim()
      if (!valueName) continue
      const delta = value.priceRaw.trim() === '' ? 0 : parseVndInput(value.priceRaw)
      if (delta === null || !vndSchema.safeParse(delta).success) {
        return { ok: false, error: `Giá cộng thêm của "${valueName}" không hợp lệ` }
      }
      values.push({ name: valueName, priceDeltaVnd: delta, active: value.active })
    }
    if (values.length === 0) return { ok: false, error: `Nhóm "${name}" cần ít nhất một lựa chọn` }

    const rules = rulesOf(group.preset, values.length)
    if (values.filter(value => value.active).length < rules.minSelect) {
      return { ok: false, error: `Nhóm "${name}" cần ít nhất một lựa chọn đang bật` }
    }
    payload.push({ name, ...rules, values })
  }
  return { ok: true, groups: payload }
}
