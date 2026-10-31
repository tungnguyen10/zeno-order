import type { ApiErrorBody } from '#shared/errors'

export function extractApiError(err: unknown): ApiErrorBody {
  const data = (err as { data?: unknown } | null)?.data
  if (data && typeof data === 'object' && 'code' in data && 'message' in data) {
    return data as ApiErrorBody
  }
  return { code: 'INTERNAL', message: 'Không kết nối được máy chủ, vui lòng thử lại' }
}
