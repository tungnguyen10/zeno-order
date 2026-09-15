import type { StorefrontCatalog } from '../../shared/types/catalog'

export type ConfigurableOptionGroup = StorefrontCatalog['optionGroups'][number]
export type ProductSelections = Record<string, string[]>

export interface ConfigurationValidation {
  valid: boolean
  errors: Record<string, string>
}

export function createDefaultSelections(
  groups: ConfigurableOptionGroup[],
): ProductSelections {
  return Object.fromEntries(groups.map(group => [
    group.id,
    group.values.filter(value => value.isDefault).map(value => value.id),
  ]))
}

export function validateProductConfiguration(
  groups: ConfigurableOptionGroup[],
  selections: ProductSelections,
  quantity: number,
  note: string,
): ConfigurationValidation {
  const errors: Record<string, string> = {}
  const groupIds = new Set(groups.map(group => group.id))

  for (const selectedGroupId of Object.keys(selections)) {
    if (!groupIds.has(selectedGroupId)) {
      errors.configuration = 'Lựa chọn không thuộc sản phẩm này.'
    }
  }

  for (const group of groups) {
    const selected = selections[group.id] ?? []
    const uniqueSelected = new Set(selected)
    const allowedValues = new Set(group.values.map(value => value.id))

    if (uniqueSelected.size !== selected.length
      || selected.some(valueId => !allowedValues.has(valueId))) {
      errors[group.id] = `Lựa chọn ${group.name} không hợp lệ.`
      continue
    }

    if (selected.length < group.minSelect) {
      errors[group.id] = `Vui lòng chọn ít nhất ${group.minSelect} mục cho ${group.name}.`
      continue
    }

    if (selected.length > group.maxSelect) {
      errors[group.id] = `Chỉ được chọn tối đa ${group.maxSelect} mục cho ${group.name}.`
    }
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    errors.quantity = 'Số lượng phải từ 1 đến 99.'
  }

  if (note.length > 500) {
    errors.note = 'Ghi chú không được vượt quá 500 ký tự.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}
