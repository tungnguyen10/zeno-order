export interface StorefrontPageError {
  statusCode: 404 | 500
  statusMessage: string
}

export function getStorefrontPageError(
  error: unknown,
  hasStore: boolean,
): StorefrontPageError | null {
  if (!error && hasStore) {
    return null
  }

  const errorRecord = isRecord(error) ? error : null
  const dataRecord = isRecord(errorRecord?.data) ? errorRecord.data : null
  const bodyError = isRecord(dataRecord?.error) ? dataRecord.error : null

  if (errorRecord?.statusCode === 404 && bodyError?.code === 'STORE_NOT_FOUND') {
    return {
      statusCode: 404,
      statusMessage: 'Không tìm thấy cửa hàng.',
    }
  }

  return {
    statusCode: 500,
    statusMessage: 'Không thể tải thông tin cửa hàng.',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
