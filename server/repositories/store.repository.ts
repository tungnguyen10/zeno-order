import type {
  PublicStoreRepository,
  PublicStoreRow,
} from '../domain/store/public-store'

interface RpcError {
  message: string
}

export interface PublicStoreRpcClient {
  rpc: (
    name: 'get_public_store_by_slug',
    args: { p_public_slug: string },
  ) => PromiseLike<{ data: PublicStoreRow[] | null, error: RpcError | null }>
}

export function createStoreRepository(client: PublicStoreRpcClient): PublicStoreRepository {
  return {
    async findPublicBySlug(publicSlug) {
      const { data, error } = await client.rpc('get_public_store_by_slug', {
        p_public_slug: publicSlug,
      })

      if (error) {
        throw new Error(error.message)
      }

      return data?.[0] ?? null
    },
  }
}
