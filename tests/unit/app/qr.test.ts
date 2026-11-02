import { describe, expect, it } from 'vitest'
import { escapeHtml, qrDataUrl, qrFilename } from '../../../app/utils/qr'

describe('qrDataUrl', () => {
  it('returns a PNG data url', async () => {
    const url = await qrDataUrl('https://zeno.vn/s/tra-sua?t=abc')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const bytes = Buffer.from(url.split(',')[1]!, 'base64')
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('encodes different links into different images', async () => {
    expect(await qrDataUrl('https://zeno.vn/s/a?t=1')).not.toBe(await qrDataUrl('https://zeno.vn/s/a?t=2'))
  })
})

describe('qrFilename', () => {
  it('builds an ascii file name from the store slug and the table name', () => {
    expect(qrFilename('tra-sua-may', 'Bàn 05')).toBe('qr-tra-sua-may-ban-05.png')
    expect(qrFilename('a', 'Bàn cửa sổ')).toBe('qr-a-ban-cua-so.png')
  })

  it('falls back to "ban" when the name has no usable characters', () => {
    expect(qrFilename('a', '???')).toBe('qr-a-ban.png')
  })
})

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<img src=x onerror="a()">&\'')).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;')
  })
})
