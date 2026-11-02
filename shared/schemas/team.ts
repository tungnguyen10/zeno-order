import { z } from 'zod'

export const INVITATION_TTL_DAYS = 7

export const inviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, 'Email quá dài').pipe(z.email('Email không hợp lệ')),
})
export type InviteInput = z.output<typeof inviteInputSchema>

export const memberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
})
export type MemberStatusInput = z.output<typeof memberStatusSchema>
