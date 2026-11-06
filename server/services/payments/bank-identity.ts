import { VIETQR_BANKS } from '../../../shared/banks'

export function normalizeBank(value: string | null | undefined): string | null {
  const clean = (s: string) => s.replace(/[^a-z0-9]/gi, '').toUpperCase()
  const key = clean(value ?? '')
  const aliases: Record<string, string> = { MB: 'MB', MBBANK: 'MB', VIETINBANK: 'ICB', KIENLONGBANK: 'KLB' }
  return aliases[key] ?? VIETQR_BANKS.find(b => [b.code, b.bin, b.shortName].some(v => clean(v) === key))?.code ?? null
}
