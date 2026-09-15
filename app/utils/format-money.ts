export function formatMoney(
  amount: string,
  currency: string,
  locale = 'vi-VN',
): string {
  if (!/^\d+$/.test(amount)) {
    throw new Error('Invalid monetary value')
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    maximumFractionDigits: 0,
  }).format(BigInt(amount))
}
