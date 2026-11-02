import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { requireEnv } from './env'

const ENV_NAME = 'APP_ENCRYPTION_KEY'
const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
// 32 bytes in canonical base64 are always 43 characters followed by a single "=".
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/

function loadKey(): Buffer {
  const raw = requireEnv(ENV_NAME)
  if (!KEY_PATTERN.test(raw)) throw new Error(`${ENV_NAME} must be 32 bytes encoded as base64`)
  return Buffer.from(raw, 'base64')
}

export function assertEncryptionKey(): void {
  loadKey()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv, { authTagLength: TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map(part => (typeof part === 'string' ? part : part.toString('base64url'))).join('.')
}

export function decryptSecret(blob: string): string {
  const parts = blob.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION || parts.slice(1).some(part => !/^[A-Za-z0-9_-]*$/.test(part))) throw new Error('Invalid encrypted secret')
  const iv = Buffer.from(parts[1]!, 'base64url')
  const tag = Buffer.from(parts[2]!, 'base64url')
  const ciphertext = Buffer.from(parts[3]!, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Invalid encrypted secret')

  const key = loadKey()
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
  catch {
    throw new Error('Invalid encrypted secret')
  }
}
