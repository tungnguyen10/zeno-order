import { assertVnd } from './money'
import { MAX_LINE_QUANTITY, orderTotals, priceLine, selectionDeltas, toOptionRules, validateSelection } from './pricing'
import type { PublicProduct } from './types/catalog'

export interface DraftLine {
  key: string
  productId: string
  name: string
  optionLabels: string[]
  valueIds: string[]
  quantity: number
  unitPriceVnd: number
}

export function lineKey(productId: string, valueIds: string[]): string {
  return `${productId}:${[...valueIds].sort().join(',')}`
}

export function addToDraft(lines: DraftLine[], product: PublicProduct, valueIds: string[], quantity: number): DraftLine[] {
  if (!product.isAvailable) throw new RangeError('Product is not available')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) throw new RangeError(`Invalid quantity: ${quantity}`)

  const rules = toOptionRules(product.optionGroups)
  const selection = validateSelection(rules, valueIds)
  if (!selection.ok) throw new RangeError(`Invalid selection: ${selection.reason}`)

  const key = lineKey(product.id, selection.valueIds)
  const existing = lines.find(line => line.key === key)
  if (existing) {
    return lines.map(line => line === existing ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + quantity) } : line)
  }

  const { unitPriceVnd } = priceLine({
    basePriceVnd: product.basePriceVnd,
    deltasVnd: selectionDeltas(rules, selection.valueIds),
    quantity: 1,
  })
  const picked = new Set(selection.valueIds)
  return [...lines, {
    key,
    productId: product.id,
    name: product.name,
    optionLabels: product.optionGroups.flatMap(group => group.values.filter(value => picked.has(value.id)).map(value => value.name)),
    valueIds: selection.valueIds,
    quantity,
    unitPriceVnd,
  }]
}

export function draftTotals(lines: DraftLine[]): { count: number, totalVnd: number } {
  const lineTotalsVnd = lines.map(line => assertVnd(line.unitPriceVnd * line.quantity))
  return {
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalVnd: orderTotals({ lineTotalsVnd, deliveryFeeVnd: 0 }).totalVnd,
  }
}
