import { z } from 'zod'

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
})
export type PushSubscriptionInput = z.output<typeof pushSubscriptionSchema>

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
})
export type PushUnsubscribeInput = z.output<typeof pushUnsubscribeSchema>
