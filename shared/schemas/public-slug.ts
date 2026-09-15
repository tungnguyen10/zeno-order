import { z } from 'zod'

const RESERVED_PUBLIC_SLUGS = new Set([
  '_nuxt',
  'admin',
  'api',
  'login',
  'order',
  's',
])

export const publicSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine(slug => !RESERVED_PUBLIC_SLUGS.has(slug), 'Reserved public slug')
