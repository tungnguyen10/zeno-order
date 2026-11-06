import { verifySepayApiKey, verifySepaySignature } from './sepay-signature'

export type WebhookAuthResult = 'OK' | 'MISSING' | 'STALE' | 'MISMATCH'

// The integration's configured mode decides the only accepted scheme; a request cannot pick a weaker one.
export function authenticateWebhook(input: {
  mode: 'HMAC' | 'APIKEY'
  secret: string
  headers: { authorization?: string, signature?: string, timestamp?: string }
  rawBody: string
  nowSec: number
}): WebhookAuthResult {
  if (input.mode === 'APIKEY') {
    return verifySepayApiKey({ authorizationHeader: input.headers.authorization, apiKey: input.secret })
  }
  return verifySepaySignature({
    rawBody: input.rawBody,
    timestamp: input.headers.timestamp,
    signatureHeader: input.headers.signature,
    secret: input.secret,
    nowSec: input.nowSec,
  })
}
