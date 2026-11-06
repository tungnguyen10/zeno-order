import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { AppError } from './errors'

/** Enforce the cap while streaming, including chunked bodies without Content-Length. */
export async function readWebhookBody(event: H3Event, limit: number): Promise<string> {
  if (Number(getHeader(event, 'content-length') ?? 0) > limit) throw new AppError('VALIDATION_FAILED', 'Yêu cầu quá lớn')
  let size = 0
  const parts: Buffer[] = []
  for await (const chunk of event.node.req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += part.length
    if (size > limit) throw new AppError('VALIDATION_FAILED', 'Yêu cầu quá lớn')
    parts.push(part)
  }
  const bytes = Buffer.concat(parts)
  const text = bytes.toString('utf8')
  if (!Buffer.from(text).equals(bytes)) throw new AppError('VALIDATION_FAILED', 'Body UTF-8 không hợp lệ')
  return text
}
