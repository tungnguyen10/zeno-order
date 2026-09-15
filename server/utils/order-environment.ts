import { z } from 'zod'

const trackingSecretsSchema = z.record(
  z.string().regex(/^[1-9]\d*$/),
  z.string().min(32),
)

const rawOrderEnvironmentSchema = z.object({
  supabaseSecretKey: z.string().min(24),
  turnstileSecretKey: z.string().min(24),
  rateLimitMax: z.coerce.number().int().min(1).max(10_000),
  rateLimitWindowSeconds: z.coerce.number().int().min(1).max(86_400),
  trackingKeyVersion: z.coerce.number().int().min(1).max(32_767),
  trackingSecretsJson: z.union([z.string().min(1), trackingSecretsSchema]),
})

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
    const fields = [...new Set(parsed.error.issues.map(issue => String(issue.path[0] ?? 'root')))]
    throw new Error(`Invalid order server runtime configuration: ${fields.join(', ')}`)
  }

  try {
    const trackingSecrets = typeof parsed.data.trackingSecretsJson === 'string'
      ? trackingSecretsSchema.parse(JSON.parse(parsed.data.trackingSecretsJson))
      : parsed.data.trackingSecretsJson
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
