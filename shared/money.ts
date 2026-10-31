const VND_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

export function assertVnd(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Invalid VND amount: ${amount}`)
  }
  return amount
}

export function formatVnd(amount: number): string {
  return `${VND_FORMAT.format(assertVnd(amount))}đ`
}
