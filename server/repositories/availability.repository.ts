import type {
  AvailabilityRepository,
  AvailabilitySource,
} from '../domain/availability/store-availability'

interface RpcError {
  message: string
}

export interface AvailabilityRpcClient {
  rpc: (
    name: 'get_storefront_availability_by_slug',
    args: { p_public_slug: string },
  ) => PromiseLike<{ data: AvailabilitySource | null, error: RpcError | null }>
}

export function createAvailabilityRepository(client: AvailabilityRpcClient): AvailabilityRepository {
  return {
    async findPublicBySlug(publicSlug) {
      const { data, error } = await client.rpc('get_storefront_availability_by_slug', {
        p_public_slug: publicSlug,
      })

      if (error) {
        throw new Error(error.message)
      }

      return data ?? null
    },
  }
}
