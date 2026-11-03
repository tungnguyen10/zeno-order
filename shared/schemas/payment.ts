import { z } from 'zod'
import { ACCOUNT_NUMBER_PATTERN, findBank, normalizeAccountNumber } from '../banks'
import { SEPAY_ENVIRONMENTS } from '../payment'

const holder = z.string().trim()
  .min(2, 'Tên chủ tài khoản cần ít nhất 2 ký tự')
  .max(80, 'Tên chủ tài khoản tối đa 80 ký tự')

export const paymentAccountInputSchema = z.object({
  bankCode: z.string().trim().transform(value => value.toUpperCase()),
  accountNumber: z.string().transform(value => normalizeAccountNumber(value)),
  accountHolder: holder,
  vaNumber: z.string().nullish(),
}).transform((value) => {
  // Object-level transform so an absent vaNumber deterministically becomes null.
  const normalized = value.vaNumber ? normalizeAccountNumber(value.vaNumber) : ''
  return { ...value, vaNumber: normalized === '' ? null : normalized }
}).superRefine((value, ctx) => {
  const bank = findBank(value.bankCode)
  if (!bank) ctx.addIssue({ code: 'custom', path: ['bankCode'], message: 'Ngân hàng chưa được hỗ trợ' })
  if (!ACCOUNT_NUMBER_PATTERN.test(value.accountNumber)) {
    ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'Số tài khoản gồm 6–19 chữ hoặc số' })
  }
  if (value.vaNumber !== null && !ACCOUNT_NUMBER_PATTERN.test(value.vaNumber)) {
    ctx.addIssue({ code: 'custom', path: ['vaNumber'], message: 'Số tài khoản ảo gồm 6–19 chữ hoặc số' })
  }
  if (bank?.vaPolicy === 'REQUIRED' && value.vaNumber === null) {
    ctx.addIssue({ code: 'custom', path: ['vaNumber'], message: `${bank.shortName} chỉ nhận tiền qua tài khoản ảo (VA), hãy nhập số VA` })
  }
})
export type PaymentAccountInput = z.output<typeof paymentAccountInputSchema>

export const paymentAccountPatchSchema = z.object({
  bankCode: z.string().max(40).optional(),
  accountNumber: z.string().max(60).optional(),
  accountHolder: z.string().max(200).optional(),
  vaNumber: z.string().max(60).nullable().optional(),
}).refine(value => Object.values(value).some(v => v !== undefined), 'Không có thay đổi nào')
export type PaymentAccountPatch = z.output<typeof paymentAccountPatchSchema>

export const createIntegrationInputSchema = z.object({
  name: z.string().trim().min(2).max(80).default('SePay'),
  environment: z.enum(SEPAY_ENVIRONMENTS).default('live'),
})
export type CreateIntegrationInput = z.output<typeof createIntegrationInputSchema>

const NO_WHITESPACE = /^\S+$/

export const sepaySecretInputSchema = z.object({
  hmacSecret: z.string().trim()
    .min(8, 'Secret Key cần ít nhất 8 ký tự')
    .max(200, 'Secret Key tối đa 200 ký tự')
    .regex(NO_WHITESPACE, 'Secret Key không chứa khoảng trắng'),
  apiToken: z.string().trim()
    .min(8, 'Token API cần ít nhất 8 ký tự')
    .max(500, 'Token API tối đa 500 ký tự')
    .regex(NO_WHITESPACE, 'Token API không chứa khoảng trắng')
    .optional(),
})
export type SepaySecretInput = z.output<typeof sepaySecretInputSchema>

export const linkAccountInputSchema = z.object({ paymentAccountId: z.uuid() })
