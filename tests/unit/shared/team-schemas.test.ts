import { describe, expect, it } from 'vitest'
import { inviteInputSchema, memberStatusSchema } from '../../../shared/schemas/team'

describe('inviteInputSchema', () => {
  it('trims and lowercases the email', () => {
    expect(inviteInputSchema.parse({ email: '  Nhan.Vien@Example.COM ' })).toEqual({ email: 'nhan.vien@example.com' })
  })

  it.each(['', 'abc', 'a@', '@b.vn', 'a b@c.vn', `${'x'.repeat(250)}@a.vn`])('rejects %j', (email) => {
    expect(inviteInputSchema.safeParse({ email }).success).toBe(false)
  })
})

describe('memberStatusSchema', () => {
  it('accepts ACTIVE and DISABLED only', () => {
    expect(memberStatusSchema.safeParse({ status: 'DISABLED' }).success).toBe(true)
    expect(memberStatusSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true)
    expect(memberStatusSchema.safeParse({ status: 'OWNER' }).success).toBe(false)
    expect(memberStatusSchema.safeParse({}).success).toBe(false)
  })
})
