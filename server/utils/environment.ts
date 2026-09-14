import { z } from 'zod'

const supabaseEnvironmentSchema = z.object({
  url: z.url(),
  key: z.string().min(24).refine(key => key !== 'local-publishable-key'),
})

export type SupabaseEnvironment = z.infer<typeof supabaseEnvironmentSchema>

export function parseSupabaseEnvironment(input: unknown): SupabaseEnvironment {
  const result = supabaseEnvironmentSchema.safeParse(input)
  if (!result.success) {
    throw new Error('Invalid Supabase runtime configuration')
  }

  return result.data
}

