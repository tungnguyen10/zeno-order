import type { ProductImageType } from '#shared/catalog-limits'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

/** Trusts the file content, never the client-declared name or content-type. */
export function detectImageType(bytes: Uint8Array): ProductImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') return 'image/webp'
  return null
}
