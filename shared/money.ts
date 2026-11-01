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

/** Parses an owner-entered VND price, treating dots and commas as thousands separators. */
export function parseVndInput(input: string): number | null {
  const text = input.toLowerCase().replace(/\s+/g, '').replace(/(vnđ|vnd|đ|d)$/u, '')
  let value: number
  const thousands = /^(\d+)(?:[.,](\d))?k$/.exec(text)
  if (thousands) value = Number(thousands[1]) * 1000 + Number(thousands[2] ?? 0) * 100
  else if (/^\d+$/.test(text)) value = Number(text)
  else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) value = Number(text.replace(/[.,]/g, ''))
  else return null
  return Number.isSafeInteger(value) ? value : null
}
