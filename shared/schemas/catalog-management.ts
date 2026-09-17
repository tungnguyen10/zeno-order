import { z } from 'zod'

const text = z.string().trim().min(1).max(120)
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63)
const sortOrder = z.number().int().min(0).max(1_000_000)
// Database money columns are non-negative bigint minor units, transported as base-10 strings.
const money = z.string().regex(/^\d{1,19}$/).refine(value => /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n)
export const resourceIdSchema = z.uuid()
export const catalogResourceSchema = z.enum(['menus', 'sections', 'products', 'menu-items', 'option-groups', 'option-values', 'product-option-groups'])
export type CatalogResource = z.infer<typeof catalogResourceSchema>

// Product-option links have no surrogate ID: the route token is productId:optionGroupId.
export const productOptionGroupIdSchema = z.string().refine(value => {
  const parts = value.split(':')
  return parts.length === 2 && parts.every(part => resourceIdSchema.safeParse(part).success)
})
export function catalogResourceIdSchema(resource: CatalogResource) {
  return resource === 'product-option-groups' ? productOptionGroupIdSchema : resourceIdSchema
}
export function parseProductOptionGroupId(value: string) {
  const [productId, optionGroupId] = productOptionGroupIdSchema.parse(value).split(':')
  return { productId: productId!, optionGroupId: optionGroupId! }
}

const menu = z.object({ name: text, isActive: z.boolean(), sortOrder }).strict()
const section = z.object({ menuId: resourceIdSchema, name: text, slug, description: z.string().max(1000).nullable(), sortOrder }).strict()
const product = z.object({ name: text, slug, description: z.string().max(2000).nullable(), basePrice: money, isActive: z.boolean(), isSoldOut: z.boolean() }).strict()
const menuItem = z.object({ menuId: resourceIdSchema, sectionId: resourceIdSchema, productId: resourceIdSchema, sortOrder }).strict()
const optionGroup = z.object({ name: text, selectionType: z.enum(['single', 'multiple']), required: z.boolean(), minSelect: z.number().int().min(0).max(99), maxSelect: z.number().int().min(1).max(99), sortOrder, isActive: z.boolean() }).strict()
const optionValue = z.object({ optionGroupId: resourceIdSchema, name: text, priceAdjustment: money, isDefault: z.boolean(), isActive: z.boolean(), sortOrder }).strict()
const productOptionGroup = z.object({ productId: resourceIdSchema, optionGroupId: resourceIdSchema, sortOrder }).strict()
type Bounds = Partial<z.infer<typeof optionGroup>>
function validBounds(value: Bounds) {
  return !(value.minSelect !== undefined && value.maxSelect !== undefined && value.minSelect > value.maxSelect)
    && !(value.required !== undefined && value.minSelect !== undefined && value.required !== (value.minSelect > 0))
    && !(value.selectionType === 'single' && ((value.maxSelect !== undefined && value.maxSelect !== 1) || (value.minSelect !== undefined && value.minSelect > 1)))
}
const nonempty = (value: object) => Object.keys(value).length > 0

export const catalogCreateSchemas = {
  menus: menu.extend({ isActive: z.boolean().default(true), sortOrder: sortOrder.default(0) }),
  sections: section.extend({ description: section.shape.description.default(null), sortOrder: sortOrder.default(0) }),
  products: product.extend({ description: product.shape.description.default(null), isActive: z.boolean().default(true), isSoldOut: z.boolean().default(false) }),
  'menu-items': menuItem.extend({ sortOrder: sortOrder.default(0) }),
  'option-groups': optionGroup.extend({ sortOrder: sortOrder.default(0), isActive: z.boolean().default(true) }).refine(validBounds, 'Invalid option bounds'),
  'option-values': optionValue.extend({ priceAdjustment: money.default('0'), isDefault: z.boolean().default(false), isActive: z.boolean().default(true), sortOrder: sortOrder.default(0) }),
  'product-option-groups': productOptionGroup.extend({ sortOrder: sortOrder.default(0) }),
}
export const catalogUpdateSchemas = {
  menus: menu.partial().refine(nonempty),
  sections: section.partial().refine(nonempty),
  products: product.partial().refine(nonempty),
  'menu-items': menuItem.partial().refine(nonempty),
  'option-groups': optionGroup.partial().refine(nonempty).refine(validBounds, 'Invalid option bounds'),
  'option-values': optionValue.partial().refine(nonempty),
  'product-option-groups': productOptionGroup.pick({ sortOrder: true }).partial().refine(nonempty),
}
export const productSoldOutSchema = z.object({ isSoldOut: z.boolean() }).strict()
export const storeSettingsSchema = z.object({
  name: text, description: z.string().max(2000).nullable(), phone: z.string().max(32).nullable(), address: z.string().max(500).nullable(),
  logoPath: z.string().max(500).nullable(), coverPath: z.string().max(500).nullable(),
  timezone: z.string().min(3).max(64).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }),
  currency: z.string().regex(/^[A-Z]{3}$/), isActive: z.boolean(), manualOpenState: z.enum(['open', 'closed', 'temporarily_closed']).nullable(),
  deliveryEnabled: z.boolean(), pickupEnabled: z.boolean(), minOrderAmount: money, defaultDeliveryFee: money,
}).strict().partial().refine(nonempty)

export const storeHoursSchema = z.array(z.object({
  dayOfWeek: z.number().int().min(0).max(6), isClosed: z.boolean(),
  openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
}).strict().superRefine((row, context) => {
  if (row.isClosed && (row.openTime !== null || row.closeTime !== null)) context.addIssue({ code: 'custom', message: 'Closed days cannot have hours' })
  if (!row.isClosed && (!row.openTime || !row.closeTime || row.openTime >= row.closeTime)) context.addIssue({ code: 'custom', message: 'Open days require a valid interval' })
})).length(7).refine(rows => new Set(rows.map(row => row.dayOfWeek)).size === 7, 'Each weekday must appear once')
export const membershipSchema = z.object({ userId: resourceIdSchema, role: z.enum(['owner', 'manager', 'staff']) }).strict()
export const membershipUpdateSchema = membershipSchema.pick({ role: true })
