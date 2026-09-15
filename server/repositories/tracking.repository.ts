import type { PublicOrderTracking } from '../../shared/types/tracking'

interface RpcError { message: string }
export interface TrackingRpcClient {
  rpc: (
    name: 'get_public_order_tracking',
    args: { p_public_slug: string, p_order_number: string, p_tracking_token_hash: string },
  ) => PromiseLike<{ data: PublicOrderTracking | null, error: RpcError | null }>
}

export function createTrackingRepository(client: TrackingRpcClient) {
  return {
    async find(publicSlug: string, orderNumber: string, tokenHash: string) {
      const { data, error } = await client.rpc('get_public_order_tracking', {
        p_public_slug: publicSlug,
        p_order_number: orderNumber,
        p_tracking_token_hash: tokenHash,
      })
      if (error) throw new Error(error.message)
      return data ?? null
    },
  }
}
