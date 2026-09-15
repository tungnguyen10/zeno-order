import { z } from 'zod'

const rawOrderEnvironmentSchema = z.object({
  supabaseSecretKey: z.string().min(24),
  turnstileSecretKey: z.string().min(24),
  rateLimitMax: z.coerce.number().int().min(1).max(10_000),
  rateLimitWindowSeconds: z.coerce.number().int().min(1).max(86_400),
  trackingKeyVersion: z.coerce.number().int().min(1).max(32_767),
  trackingSecretsJson: z.string().min(1),
})

const trackingSecretsSchema = z.record(
  z.string().regex(/^[1-9]\d*$/),
  z.string().min(32),
)

export interface OrderServerEnvironment {
  supabaseSecretKey: string
  turnstileSecretKey: string
  rateLimitMax: number
  rateLimitWindowSeconds: number
  trackingKeyVersion: number
  trackingSecrets: Record<string, string>
}

export function parseOrderServerEnvironment(input: unknown): OrderServerEnvironment {
  const parsed = rawOrderEnvironmentSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('Invalid order server runtime configuration')
  }

  try {
    const trackingSecrets = trackingSecretsSchema.parse(JSON.parse(parsed.data.trackingSecretsJson))
    if (!trackingSecrets[String(parsed.data.trackingKeyVersion)]) {
      throw new Error('Current tracking key version is missing')
    }

    return {
      supabaseSecretKey: parsed.data.supabaseSecretKey,
      turnstileSecretKey: parsed.data.turnstileSecretKey,
      rateLimitMax: parsed.data.rateLimitMax,
      rateLimitWindowSeconds: parsed.data.rateLimitWindowSeconds,
      trackingKeyVersion: parsed.data.trackingKeyVersion,
      trackingSecrets,
    }
  }
  catch {
    throw new Error('Invalid order server runtime configuration')
  }
}
