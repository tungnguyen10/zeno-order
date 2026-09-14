import { z } from 'zod'

import type { PublicStoreSummary } from '../../../shared/types/storefront'

const RESERVED_PUBLIC_SLUGS = new Set([
  '_nuxt',
  'admin',
  'api',
  'login',
  'order',
  's',
])

export const publicSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine(slug => !RESERVED_PUBLIC_SLUGS.has(slug), 'Reserved public slug')

export interface PublicStoreRow {
  public_slug: string
  name: string
  description: string | null
  logo_path: string | null
  timezone: string
  currency: string
}

export interface PublicStoreRepository {
  findPublicBySlug: (publicSlug: string) => Promise<PublicStoreRow | null>
}

export class StoreNotFoundError extends Error {
  readonly code = 'STORE_NOT_FOUND'
  readonly statusCode = 404

  constructor() {
    super('Không tìm thấy cửa hàng.')
    this.name = 'StoreNotFoundError'
  }
}

export function mapPublicStore(row: PublicStoreRow): PublicStoreSummary {
  return {
    publicSlug: row.public_slug,
    name: row.name,
    description: row.description,
    logoPath: row.logo_path,
    timezone: row.timezone,
    currency: row.currency,
  }
}

export function createPublicStoreService(repository: PublicStoreRepository) {
  return {
    async resolve(publicSlug: string): Promise<PublicStoreSummary> {
      const parsed = publicSlugSchema.safeParse(publicSlug)
      if (!parsed.success) {
        throw new StoreNotFoundError()
      }

      const row = await repository.findPublicBySlug(parsed.data)
      if (!row) {
        throw new StoreNotFoundError()
      }

      return mapPublicStore(row)
    },
  }
}
