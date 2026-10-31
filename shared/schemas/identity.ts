import { z } from 'zod'

export const RESERVED_SLUGS = [
  'admin', 'api', 'app', 'assets', 'auth', 'help', 'invite', 'login', 'logout', 'o', 'onboarding',
  's', 'settings', 'signup', 'static', 'support', 'www', 'zeno', '_nuxt',
] as const

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG = 40

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
}

export const slugSchema = z.string()
  .trim()
  .toLowerCase()
  .min(3, 'Đường dẫn cần ít nhất 3 ký tự')
  .max(MAX_SLUG, `Đường dẫn tối đa ${MAX_SLUG} ký tự`)
  .regex(SLUG_PATTERN, 'Chỉ dùng chữ thường không dấu, số và dấu gạch ngang')
  .refine(value => !(RESERVED_SLUGS as readonly string[]).includes(value), 'Đường dẫn này đã được hệ thống dùng')

const nameSchema = z.string().trim().min(2, 'Cần ít nhất 2 ký tự').max(80, 'Tối đa 80 ký tự')

export const onboardingInputSchema = z.object({
  orgName: nameSchema,
  storeName: nameSchema,
  storeSlug: slugSchema,
})
export type OnboardingInput = z.output<typeof onboardingInputSchema>

export const updateStoreInputSchema = z.object({
  name: nameSchema.optional(),
  isAcceptingOrders: z.boolean().optional(),
}).refine(value => Object.values(value).some(v => v !== undefined), 'Không có thay đổi nào')
export type UpdateStoreInput = z.output<typeof updateStoreInputSchema>
