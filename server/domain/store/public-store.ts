import type { PublicStoreSummary } from '../../../shared/types/storefront'
import { publicSlugSchema } from '../../../shared/schemas/public-slug'

export { publicSlugSchema } from '../../../shared/schemas/public-slug'

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
