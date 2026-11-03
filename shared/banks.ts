export type VaPolicy = 'REQUIRED' | 'OPTIONAL'

export interface VietQrBank {
  /** VietQR/NAPAS code from banks.json, e.g. `VCB`. */
  code: string
  /** 6-digit bank identification number; the value sent as the `bank` QR parameter. */
  bin: string
  shortName: string
  vaPolicy: VaPolicy
  /** Bank appears in SePay's webhook support table (developer.sepay.vn tai-khoan-ngan-hang). */
  sepayWebhook: boolean
}

const bank = (code: string, bin: string, shortName: string, vaPolicy: VaPolicy = 'OPTIONAL', sepayWebhook = false): VietQrBank =>
  ({ code, bin, shortName, vaPolicy, sepayWebhook })

// Source: https://vietqr.app/banks.json, entries with supported=true (checked 2026-11-01).
export const VIETQR_BANKS: readonly VietQrBank[] = [
  bank('VCB', '970436', 'Vietcombank'),
  bank('TCB', '970407', 'Techcombank'),
  bank('ICB', '970415', 'VietinBank', 'OPTIONAL', true),
  bank('BIDV', '970418', 'BIDV', 'REQUIRED', true),
  bank('VBA', '970405', 'Agribank'),
  bank('MB', '970422', 'MBBank', 'OPTIONAL', true),
  bank('ACB', '970416', 'ACB', 'OPTIONAL', true),
  bank('VPB', '970432', 'VPBank', 'OPTIONAL', true),
  bank('TPB', '970423', 'TPBank', 'OPTIONAL', true),
  bank('STB', '970403', 'Sacombank', 'OPTIONAL', true),
  bank('MSB', '970426', 'MSB', 'REQUIRED', true),
  bank('OCB', '970448', 'OCB', 'REQUIRED', true),
  bank('KLB', '970452', 'KienLongBank', 'REQUIRED', true),
  bank('LPB', '970449', 'LPBank'),
  bank('VCCB', '970454', 'BVBank'),
  bank('VIB', '970441', 'VIB'),
  bank('HDB', '970437', 'HDBank'),
  bank('SEAB', '970440', 'SeABank'),
  bank('SHBVN', '970424', 'Shinhan Bank'),
  bank('BAB', '970409', 'BacABank'),
  bank('ABB', '970425', 'ABBANK'),
  bank('EIB', '970431', 'Eximbank'),
  bank('PBVN', '970439', 'Public Bank'),
]

export function findBank(code: string): VietQrBank | undefined {
  const wanted = code.trim().toUpperCase()
  return VIETQR_BANKS.find(b => b.code === wanted)
}

/** VietQR account numbers are letters or digits, at most 19 characters (vietqr.io quick link). */
export const ACCOUNT_NUMBER_PATTERN = /^[A-Z0-9]{6,19}$/

export function normalizeAccountNumber(input: string): string {
  return input.replace(/[\s.-]/g, '').toUpperCase()
}
