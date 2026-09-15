import { describe, expect, it } from 'vitest'

import { getStorefrontPageError } from '../../app/utils/storefront-page-error'

describe('getStorefrontPageError', () => {
  it('keeps the stable store-not-found response as a 404', () => {
    expect(getStorefrontPageError({
      statusCode: 404,
      data: { error: { code: 'STORE_NOT_FOUND' } },
    }, false)).toEqual({
      statusCode: 404,
      statusMessage: 'Không tìm thấy cửa hàng.',
    })
  })

  it('maps an upstream database failure to a generic 500', () => {
    expect(getStorefrontPageError({ statusCode: 500 }, false)).toEqual({
      statusCode: 500,
      statusMessage: 'Không thể tải thông tin cửa hàng.',
    })
  })

  it('treats an empty successful payload as a server contract failure', () => {
    expect(getStorefrontPageError(null, false)).toEqual({
      statusCode: 500,
      statusMessage: 'Không thể tải thông tin cửa hàng.',
    })
  })

  it('returns no page error when store data exists', () => {
    expect(getStorefrontPageError(null, true)).toBeNull()
  })
})
