import type {
  PublicCatalogRepository,
  PublicCatalogRpcRow,
} from '../domain/catalog/public-catalog'

interface RpcError {
  message: string
}

export interface PublicCatalogRpcClient {
  rpc: (
    name: 'get_storefront_catalog_by_slug',
    args: { p_public_slug: string },
  ) => PromiseLike<{ data: PublicCatalogRpcRow | null, error: RpcError | null }>
}

export function createCatalogRepository(client: PublicCatalogRpcClient): PublicCatalogRepository {
  return {
    async findPublicBySlug(publicSlug) {
      const { data, error } = await client.rpc('get_storefront_catalog_by_slug', {
        p_public_slug: publicSlug,
      })

      if (error) {
        throw new Error(error.message)
      }

      return data ?? null
    },
  }
}
