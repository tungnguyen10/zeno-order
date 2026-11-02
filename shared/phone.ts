const SEPARATORS = /[\s.\-()]/g
const MOBILE_PREFIX = /^0(?:3|5|7|8|9)\d{8}$/

/** Accepts +84 / 84 / 0 prefixes and common separators; returns the 10-digit 0xxxxxxxxx form or null. */
export function normalizeVnPhone(input: string): string | null {
  const compact = input.replace(SEPARATORS, '')
  let national: string
  if (/^\+84\d{9}$/.test(compact)) national = `0${compact.slice(3)}`
  else if (/^84\d{9}$/.test(compact)) national = `0${compact.slice(2)}`
  else if (/^0\d{9}$/.test(compact)) national = compact
  else return null
  return MOBILE_PREFIX.test(national) ? national : null
}

export function maskPhone(phone: string | null): string | null {
  if (phone === null) return null
  return `${'*'.repeat(Math.max(phone.length - 3, 0))}${phone.slice(-3)}`
}
