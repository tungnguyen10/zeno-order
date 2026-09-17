export const MAX_PRODUCT_IMAGE_EDGE = 1200
export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024

const WEBP_QUALITIES = [0.86, 0.76, 0.66, 0.56, 0.46] as const
const INPUT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface DecodedProductImage {
  width: number
  height: number
  source: unknown
  close?: () => void
}

export interface ProductImageCodec {
  decode: (file: File) => Promise<DecodedProductImage>
  encode: (image: DecodedProductImage, width: number, height: number, quality: number) => Promise<Blob>
}

export function productImagePath(storeId: string, productId: string) {
  return `stores/${storeId}/products/${productId}/main.webp`
}

export function scaleWithin(width: number, height: number, maxEdge = MAX_PRODUCT_IMAGE_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Kích thước ảnh không hợp lệ.')
  }
  const ratio = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

async function encodeWithBrowserCanvas(image: DecodedProductImage, width: number, height: number, quality: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Trình duyệt không thể xử lý ảnh.')
    context.drawImage(image.source as CanvasImageSource, 0, 0, width, height)
    return canvas.convertToBlob({ type: 'image/webp', quality })
  }

  if (typeof document === 'undefined') throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Trình duyệt không thể xử lý ảnh.')
  context.drawImage(image.source as CanvasImageSource, 0, 0, width, height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Không thể chuyển ảnh sang WebP.')),
      'image/webp',
      quality,
    )
  })
}

const browserCodec: ProductImageCodec = {
  async decode(file) {
    if (typeof createImageBitmap !== 'function') throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.')
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
  },
  encode: encodeWithBrowserCanvas,
}

export async function compressProductImage(file: File, codec: ProductImageCodec = browserCodec) {
  if (!INPUT_MIME_TYPES.has(file.type)) throw new Error('Định dạng ảnh không được hỗ trợ.')

  const image = await codec.decode(file)
  try {
    const { width, height } = scaleWithin(image.width, image.height)
    for (const quality of WEBP_QUALITIES) {
      const blob = await codec.encode(image, width, height, quality)
      if (blob.type !== 'image/webp') throw new Error('Trình duyệt không thể tạo ảnh WebP.')
      if (blob.size <= MAX_PRODUCT_IMAGE_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'product'
        return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() })
      }
    }
    throw new Error('Ảnh vẫn vượt quá 2 MiB sau khi nén.')
  }
  finally {
    image.close?.()
  }
}
