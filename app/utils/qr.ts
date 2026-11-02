import { slugify } from '#shared/schemas/identity'

type QrModule = typeof import('qrcode')

export async function qrDataUrl(text: string, width = 512): Promise<string> {
  const loaded = await import('qrcode') as QrModule & { default?: QrModule }
  const qr = loaded.default ?? loaded
  return qr.toDataURL(text, { width, margin: 2, errorCorrectionLevel: 'M' })
}

export function qrFilename(storeSlug: string, tableName: string): string {
  return `qr-${storeSlug}-${slugify(tableName) || 'ban'}.png`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function printQr(dataUrl: string, title: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0'
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }
  frame.srcdoc = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + '<style>body{font-family:sans-serif;text-align:center;margin:0;padding:24px}img{width:320px;height:320px}h1{font-size:28px}</style>'
    + `</head><body><h1>${escapeHtml(title)}</h1><img src="${dataUrl}" alt=""><p>Quét mã để gọi món</p></body></html>`
  document.body.appendChild(frame)
}
