import { describe, expect, it } from 'vitest'
import { urlBase64ToUint8Array } from '../../../app/utils/push'

describe('urlBase64ToUint8Array', () => {
  it('round-trips bytes through URL-safe base64 without padding', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255, 128, 64])
    const base64url = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(Array.from(urlBase64ToUint8Array(base64url))).toEqual(Array.from(bytes))
  })

  it('decodes a known value', () => {
    expect(Array.from(urlBase64ToUint8Array('YWJj'))).toEqual([97, 98, 99])
  })
})
