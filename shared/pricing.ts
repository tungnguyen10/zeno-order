import { assertVnd } from './money'

export const MAX_LINE_QUANTITY = 50

export interface OptionGroupRule {
  id: string
  minSelect: number
  maxSelect: number
  required: boolean
  values: { id: string, priceDeltaVnd: number, active: boolean }[]
}

export type SelectionFailureReason =
  | 'REQUIRED_MISSING'
  | 'TOO_FEW'
  | 'TOO_MANY'
  | 'UNKNOWN_VALUE'
  | 'INACTIVE_VALUE'
  | 'DUPLICATE_VALUE'

export type SelectionResult =
  | { ok: true, valueIds: string[] }
  | { ok: false, reason: SelectionFailureReason, groupId?: string }

function fail(reason: SelectionFailureReason, groupId?: string): SelectionResult {
  return groupId === undefined ? { ok: false, reason } : { ok: false, reason, groupId }
}

export function validateSelection(groups: OptionGroupRule[], selected: string[]): SelectionResult {
  const owner = new Map<string, { group: OptionGroupRule, active: boolean }>()
  for (const group of groups) {
    for (const value of group.values) owner.set(value.id, { group, active: value.active })
  }

  const seen = new Set<string>()
  for (const id of selected) {
    const entry = owner.get(id)
    if (seen.has(id)) return fail('DUPLICATE_VALUE', entry?.group.id)
    seen.add(id)
    if (!entry) return fail('UNKNOWN_VALUE')
    if (!entry.active) return fail('INACTIVE_VALUE', entry.group.id)
  }

  const valueIds: string[] = []
  for (const group of groups) {
    const picked = group.values.filter(value => seen.has(value.id)).map(value => value.id)
    if (group.required && picked.length === 0) return fail('REQUIRED_MISSING', group.id)
    if (picked.length < group.minSelect) return fail('TOO_FEW', group.id)
    if (picked.length > group.maxSelect) return fail('TOO_MANY', group.id)
    valueIds.push(...picked)
  }
  return { ok: true, valueIds }
}

export function defaultSelection(groups: OptionGroupRule[]): string[] {
  const picked: string[] = []
  for (const group of groups) {
    if (!group.required) continue
    const needed = Math.max(group.minSelect, 1)
    picked.push(...group.values.filter(value => value.active).slice(0, needed).map(value => value.id))
  }
  return picked
}

export function toggleSelection(group: OptionGroupRule, selected: string[], valueId: string): string[] {
  const value = group.values.find(candidate => candidate.id === valueId)
  if (!value || !value.active) return selected

  const inGroup = group.values.filter(candidate => selected.includes(candidate.id)).map(candidate => candidate.id)
  const others = selected.filter(id => !inGroup.includes(id))

  if (inGroup.includes(valueId)) {
    // A required single-choice group is a radio: tapping the chosen value must not leave it empty.
    if (group.maxSelect === 1 && group.required) return selected
    return [...others, ...inGroup.filter(id => id !== valueId)]
  }
  if (group.maxSelect === 1) return [...others, valueId]
  if (inGroup.length >= group.maxSelect) return selected
  return [...others, ...inGroup, valueId]
}

export function selectionDeltas(groups: OptionGroupRule[], valueIds: string[]): number[] {
  const picked = new Set(valueIds)
  return groups.flatMap(group => group.values.filter(value => picked.has(value.id)).map(value => value.priceDeltaVnd))
}

export function priceLine(input: { basePriceVnd: number, deltasVnd: number[], quantity: number }): { unitPriceVnd: number, lineTotalVnd: number } {
  const { quantity } = input
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw new RangeError(`Invalid quantity: ${quantity}`)
  }
  let unitPriceVnd = assertVnd(input.basePriceVnd)
  for (const delta of input.deltasVnd) unitPriceVnd = assertVnd(unitPriceVnd + assertVnd(delta))
  return { unitPriceVnd, lineTotalVnd: assertVnd(unitPriceVnd * quantity) }
}

export function orderTotals(input: { lineTotalsVnd: number[], deliveryFeeVnd: number }): { subtotalVnd: number, deliveryFeeVnd: number, totalVnd: number } {
  let subtotalVnd = 0
  for (const line of input.lineTotalsVnd) subtotalVnd = assertVnd(subtotalVnd + assertVnd(line))
  const deliveryFeeVnd = assertVnd(input.deliveryFeeVnd)
  return { subtotalVnd, deliveryFeeVnd, totalVnd: assertVnd(subtotalVnd + deliveryFeeVnd) }
}

export function toOptionRules(
  groups: ReadonlyArray<{
    id: string
    minSelect: number
    maxSelect: number
    required: boolean
    values: ReadonlyArray<{ id: string, priceDeltaVnd: number, active?: boolean }>
  }>,
): OptionGroupRule[] {
  return groups.map(group => ({
    id: group.id,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    required: group.required,
    values: group.values.map(value => ({ id: value.id, priceDeltaVnd: value.priceDeltaVnd, active: value.active ?? true })),
  }))
}
