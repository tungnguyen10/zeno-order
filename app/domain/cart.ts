import type { CartItem } from '../../shared/types/cart'

function parseMoney(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error('Invalid monetary value')
  }

  return BigInt(value)
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new Error('Invalid cart quantity')
  }
}

export function calculateUnitPrice(
  item: Pick<CartItem, 'basePrice' | 'options'>,
): string {
  return item.options
    .reduce(
      (total, option) => total + parseMoney(option.priceAdjustment),
      parseMoney(item.basePrice),
    )
    .toString()
}

export function calculateLineTotal(
  item: Pick<CartItem, 'basePrice' | 'options' | 'quantity'>,
): string {
  assertQuantity(item.quantity)
  return (BigInt(calculateUnitPrice(item)) * BigInt(item.quantity)).toString()
}

export function calculateCartSubtotal(
  items: Array<Pick<CartItem, 'basePrice' | 'options' | 'quantity'>>,
): string {
  return items
    .reduce((total, item) => total + BigInt(calculateLineTotal(item)), 0n)
    .toString()
}
