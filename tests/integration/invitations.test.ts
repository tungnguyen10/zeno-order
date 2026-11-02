import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { VerifiedUser } from '../../server/auth/jwt'
import { closeDb, getDb } from '../../server/db/client'
import { organizations, storeInvitations, storeMembers, stores, userProfiles } from '../../server/db/schema'
import { findStoreAccess } from '../../server/repositories/membership'
import { acceptInvitation, previewInvitation } from '../../server/services/identity/invitations'
import { resetDb } from '../support/db'
import { addStaff, createStore, createTenant, createUser } from '../support/fixtures'
import { createInvitationRow } from '../support/order-fixtures'

const STRICT = { requireVerifiedEmail: true }
const verified = (userId: string, email: string): VerifiedUser => ({ userId, email, name: 'Nhân viên', emailVerified: true })
const membersOf = (storeId: string) => getDb().select().from(storeMembers).where(eq(storeMembers.storeId, storeId))
const invitationOf = async (id: string) => (await getDb().select().from(storeInvitations).where(eq(storeInvitations.id, id)))[0]!

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('acceptInvitation', () => {
  it('creates profile + membership in one transaction and marks the invitation used', async () => {
    const a = await createTenant('acc')
    const { token, row } = await createInvitationRow(a.store, { email: 'moi@example.com', createdBy: a.owner.userId })
    const userId = `user_${randomUUID()}` // chưa có user_profiles
    const result = await acceptInvitation(getDb(), verified(userId, 'Moi@Example.COM'), token, STRICT)

    expect(result.store).toMatchObject({ id: a.store.id, orgId: a.org.id, name: a.store.name, slug: a.store.slug, role: 'STAFF' })
    expect(await findStoreAccess(getDb(), userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    const [profile] = await getDb().select().from(userProfiles).where(eq(userProfiles.userId, userId))
    expect(profile).toMatchObject({ email: 'moi@example.com' })
    expect(await invitationOf(row.id)).toMatchObject({ acceptedBy: userId })
    expect((await invitationOf(row.id)).acceptedAt).toBeInstanceOf(Date)
  })

  it('email mismatch → FORBIDDEN, rolls everything back, and does NOT burn the token', async () => {
    const a = await createTenant('mismatch')
    const { token, row } = await createInvitationRow(a.store, { email: 'dung@example.com', createdBy: a.owner.userId })
    const intruderId = `user_${randomUUID()}`

    await expect(acceptInvitation(getDb(), verified(intruderId, 'sai@example.com'), token, STRICT))
      .rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'EMAIL_MISMATCH' } })
    expect(await getDb().select().from(userProfiles).where(eq(userProfiles.userId, intruderId))).toHaveLength(0)
    expect(await membersOf(a.store.id)).toHaveLength(0)
    expect((await invitationOf(row.id)).acceptedAt).toBeNull()

    const rightId = `user_${randomUUID()}`
    await expect(acceptInvitation(getDb(), verified(rightId, 'dung@example.com'), token, STRICT)).resolves.toBeTruthy()
  })

  it('requires a verified email unless the flag is off', async () => {
    const a = await createTenant('verify')
    const { token, row } = await createInvitationRow(a.store, { email: 'chua@example.com', createdBy: a.owner.userId })
    const userId = `user_${randomUUID()}`
    const unverified: VerifiedUser = { userId, email: 'chua@example.com', name: null }

    await expect(acceptInvitation(getDb(), unverified, token, STRICT))
      .rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'EMAIL_NOT_VERIFIED' } })
    expect((await invitationOf(row.id)).acceptedAt).toBeNull()
    await expect(acceptInvitation(getDb(), unverified, token, { requireVerifiedEmail: false })).resolves.toBeTruthy()
  })

  it.each([
    ['unknown token', 'x'.repeat(43)],
    ['garbage token', 'abc'],
  ])('%s → NOT_FOUND', async (_label, token) => {
    await createTenant('nf')
    await expect(acceptInvitation(getDb(), verified('u1', 'a@example.com'), token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('expired and already-used invitations → NOT_FOUND', async () => {
    const a = await createTenant('dead')
    const expired = await createInvitationRow(a.store, { email: 'e@example.com', createdBy: a.owner.userId, expiresAt: new Date(Date.now() - 1000) })
    const used = await createInvitationRow(a.store, { email: 'u@example.com', createdBy: a.owner.userId, acceptedAt: new Date() })
    await expect(acceptInvitation(getDb(), verified('u-e', 'e@example.com'), expired.token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(acceptInvitation(getDb(), verified('u-u', 'u@example.com'), used.token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await membersOf(a.store.id)).toHaveLength(0)
  })

  it('is single-use under concurrency: 4 simultaneous accepts → 1 success, 1 membership', async () => {
    const a = await createTenant('par')
    const { token } = await createInvitationRow(a.store, { email: 'par@example.com', createdBy: a.owner.userId })
    const user = verified(`user_${randomUUID()}`, 'par@example.com')
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => acceptInvitation(getDb(), user, token, STRICT)))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await membersOf(a.store.id)).toHaveLength(1)
  })

  it('re-activates a previously disabled member', async () => {
    const a = await createTenant('react')
    const disabled = await addStaff(a.store, { status: 'DISABLED' })
    const { token } = await createInvitationRow(a.store, { email: disabled.email, createdBy: a.owner.userId })
    await acceptInvitation(getDb(), verified(disabled.userId, disabled.email), token, STRICT)
    expect(await findStoreAccess(getDb(), disabled.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    expect(await membersOf(a.store.id)).toHaveLength(1)
  })

  it('keeps an existing owner role and returns the effective store role', async () => {
    const a = await createTenant('existing-owner')
    const owner = await createUser({ email: 'existing-owner@example.com' })
    await getDb().insert(storeMembers).values({ orgId: a.org.id, storeId: a.store.id, userId: owner.userId, role: 'OWNER' })
    const { token } = await createInvitationRow(a.store, { email: owner.email, createdBy: a.owner.userId })
    const result = await acceptInvitation(getDb(), verified(owner.userId, owner.email), token, STRICT)
    expect(result.store.role).toBe('OWNER')
    expect(await findStoreAccess(getDb(), owner.userId, a.store.id)).toMatchObject({ role: 'OWNER' })
    expect(await membersOf(a.store.id)).toHaveLength(1)
  })

  it('returns OWNER for an existing organization owner', async () => {
    const a = await createTenant('existing-org-owner')
    const { token } = await createInvitationRow(a.store, { email: a.owner.email, createdBy: a.owner.userId })
    const result = await acceptInvitation(getDb(), verified(a.owner.userId, a.owner.email), token, STRICT)
    expect(result.store.role).toBe('OWNER')
  })

  it('a suspended organization makes preview and acceptance NOT_FOUND', async () => {
    const a = await createTenant('suspended-org')
    const { token } = await createInvitationRow(a.store, { email: 's@example.com', createdBy: a.owner.userId })
    await getDb().update(organizations).set({ status: 'SUSPENDED' }).where(eq(organizations.id, a.org.id))
    const user = verified('suspended-user', 's@example.com')
    await expect(previewInvitation(getDb(), user, token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(acceptInvitation(getDb(), user, token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('a suspended store makes the invitation NOT_FOUND', async () => {
    const a = await createTenant('susp')
    const { token } = await createInvitationRow(a.store, { email: 's@example.com', createdBy: a.owner.userId })
    await getDb().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, a.store.id))
    await expect(acceptInvitation(getDb(), verified('u-s', 's@example.com'), token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('does not hand out access to another store of the same org', async () => {
    const a = await createTenant('scope')
    const invitee = await createUser({ email: 'scope@example.com' })
    const { token } = await createInvitationRow(a.store, { email: invitee.email, createdBy: a.owner.userId })
    await acceptInvitation(getDb(), verified(invitee.userId, invitee.email), token, STRICT)
    const other = await createStore(a.org.id, 'other')
    expect(await findStoreAccess(getDb(), invitee.userId, other.id)).toBeNull()
  })
})

describe('previewInvitation', () => {
  it('shows the store, a masked email and whether the caller matches', async () => {
    const a = await createTenant('prev')
    const { token } = await createInvitationRow(a.store, { email: 'nhanvien@example.com', createdBy: a.owner.userId })
    const match = await previewInvitation(getDb(), verified('u1', 'NhanVien@example.com'), token)
    expect(match).toMatchObject({ storeName: a.store.name, role: 'STAFF', emailHint: 'n***@example.com', emailMatches: true, emailVerified: true })
    const mismatch = await previewInvitation(getDb(), { userId: 'u2', email: 'khac@example.com', name: null }, token)
    expect(mismatch).toMatchObject({ emailMatches: false, emailVerified: false })
    expect(JSON.stringify(mismatch)).not.toContain('nhanvien@example.com')
  })

  it('NOT_FOUND for unknown, expired and used tokens', async () => {
    const a = await createTenant('prev-nf')
    const expired = await createInvitationRow(a.store, { email: 'e@example.com', createdBy: a.owner.userId, expiresAt: new Date(Date.now() - 1000) })
    const used = await createInvitationRow(a.store, { email: 'u@example.com', createdBy: a.owner.userId, acceptedAt: new Date() })
    for (const token of ['x'.repeat(43), expired.token, used.token]) {
      await expect(previewInvitation(getDb(), verified('u', 'e@example.com'), token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  })
})
