export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number]
