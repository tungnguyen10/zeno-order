import { describe, expect, it } from 'vitest'
import { detectImageType } from '../../../server/utils/image-type'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'))

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their signatures', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg')
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe('image/png')
    expect(detectImageType(Uint8Array.from([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')]))).toBe('image/webp')
  })

  it('rejects text, empty and truncated input', () => {
    expect(detectImageType(ascii('hello world, I am not an image'))).toBeNull()
    expect(detectImageType(new Uint8Array())).toBeNull()
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull()
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull()
  })

  it('does not mistake other RIFF containers for WebP', () => {
    expect(detectImageType(Uint8Array.from([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')]))).toBeNull()
  })

  it('does not accept GIF or SVG', () => {
    expect(detectImageType(ascii('GIF89a......'))).toBeNull()
    expect(detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
  })
})
