import { randomInt } from 'node:crypto'
import { ACCOUNT_NUMBER_PATTERN, findBank } from '#shared/banks'
import { assertVnd } from '#shared/money'

export const PAYMENT_CODE_PREFIX = 'ZO'
const SUFFIX_LENGTH = 8
export const PAYMENT_CODE_PATTERN = /^ZO[A-Z0-9]{8}$/
/** Payment code of the throw-away QR used to confirm an account; PR6 recognises it as a test transaction. */
export const PAYMENT_TEST_CODE = 'ZOTEST0000'
/** Embed URL from https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code (qr.sepay.vn/img answers identically). */
export const QR_IMAGE_ORIGIN = 'https://vietqr.app/img'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MAX_AMOUNT_VND = 9_999_999_999_999

export function generatePaymentCode(random: (max: number) => number = max => randomInt(max)): string {
  let suffix = ''
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += ALPHABET[random(ALPHABET.length)]
  return `${PAYMENT_CODE_PREFIX}${suffix}`
}

function requireBank(bankCode: string) {
  const bank = findBank(bankCode)
  if (!bank) throw new RangeError(`Unknown bank code: ${bankCode}`)
  return bank
}

export function buildTransferContent(bankCode: string, paymentCode: string): string {
  const bank = requireBank(bankCode)
  if (!PAYMENT_CODE_PATTERN.test(paymentCode)) throw new RangeError('Malformed payment code')
  // VietinBank personal/household accounts only push the transaction to SePay when the content contains SEVQR.
  return bank.code === 'ICB' ? `SEVQR ${paymentCode}` : paymentCode
}

export function buildVietQrUrl(input: { bankCode: string, accountNumber: string, amountVnd: number, paymentCode: string }): string {
  const bank = requireBank(input.bankCode)
  assertVnd(input.amountVnd)
  if (input.amountVnd < 1 || input.amountVnd > MAX_AMOUNT_VND) throw new RangeError(`QR amount out of range: ${input.amountVnd}`)
  if (!ACCOUNT_NUMBER_PATTERN.test(input.accountNumber)) throw new RangeError('Malformed account number')
  const query: [string, string][] = [
    ['acc', input.accountNumber],
    ['bank', bank.bin],
    ['amount', String(input.amountVnd)],
    ['des', buildTransferContent(bank.code, input.paymentCode)],
    ['template', 'qronly'],
  ]
  return `${QR_IMAGE_ORIGIN}?${query.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
}
