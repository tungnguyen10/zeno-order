import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { storeInvitations } from '../../server/db/schema'
import { findStoreAccess } from '../../server/repositories/membership'
import { createInvitation, listTeam, revokeInvitation, setMemberStatus } from '../../server/services/identity/team'
import { hashToken } from '../../server/utils/tokens'
import { resetDb } from '../support/db'
import { addStaff, createTenant, createUser } from '../support/fixtures'
import { createInvitationRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ownerCtx = (t: Tenant): StoreContext => ({ orgId: t.org.id, storeId: t.store.id, role: 'OWNER', userId: t.owner.userId })
const BASE = 'https://zeno.test'
const pendingOf = (storeId: string) => getDb().select().from(storeInvitations).where(eq(storeInvitations.storeId, storeId))

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createInvitation', () => {
  it('returns the link once, stores only the hash, expires in 7 days', async () => {
    const a = await createTenant('inv')
    const result = await createInvitation(getDb(), ownerCtx(a), { email: 'nhanvien@example.com' }, BASE)
    const match = result.inviteUrl.match(/^https:\/\/zeno\.test\/invite\/([A-Za-z0-9_-]{43})$/)
    expect(match).not.toBeNull()
    const token = match![1]!

    const [row] = await pendingOf(a.store.id)
    expect(row).toMatchObject({ email: 'nhanvien@example.com', role: 'STAFF', tokenHash: hashToken(token), createdBy: a.owner.userId, acceptedAt: null })
    expect(JSON.stringify(row)).not.toContain(token)
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
    expect(result.invitation).toMatchObject({ id: row!.id, email: 'nhanvien@example.com', expired: false })
    expect(JSON.stringify(result.invitation)).not.toContain(token)
  })

  it('replaces the pending invitation for the same email (old link dies)', async () => {
    const a = await createTenant('replace')
    const first = await createInvitation(getDb(), ownerCtx(a), { email: 'x@example.com' }, BASE)
    const second = await createInvitation(getDb(), ownerCtx(a), { email: 'x@example.com' }, BASE)
    expect(second.inviteUrl).not.toBe(first.inviteUrl)
    const rows = await pendingOf(a.store.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tokenHash).toBe(hashToken(second.inviteUrl.split('/').pop()!))
  })

  it('five simultaneous invites for one email leave exactly one pending row', async () => {
    const a = await createTenant('par')
    await Promise.all(Array.from({ length: 5 }, () => createInvitation(getDb(), ownerCtx(a), { email: 'par@example.com' }, BASE)))
    expect(await pendingOf(a.store.id)).toHaveLength(1)
  })

  it('rejects an email that is already an active member or an org owner, but allows a disabled one', async () => {
    const a = await createTenant('member')
    const staff = await addStaff(a.store)
    const disabled = await addStaff(a.store, { status: 'DISABLED' })
    await expect(createInvitation(getDb(), ownerCtx(a), { email: staff.email }, BASE))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'ALREADY_MEMBER' } })
    await expect(createInvitation(getDb(), ownerCtx(a), { email: a.owner.email }, BASE))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'ALREADY_MEMBER' } })
    await expect(createInvitation(getDb(), ownerCtx(a), { email: disabled.email }, BASE)).resolves.toBeTruthy()
  })
})

describe('listTeam', () => {
  it('lists owners, staff and pending invitations of this store only, without secrets', async () => {
    const a = await createTenant('list')
    const b = await createTenant('list-b')
    const staff = await addStaff(a.store)
    await addStaff(b.store)
    const { token } = await createInvitationRow(a.store, { email: 'cho@example.com', createdBy: a.owner.userId })
    await createInvitationRow(b.store, { email: 'khac@example.com', createdBy: b.owner.userId })

    const team = await listTeam(getDb(), ownerCtx(a))
    expect(team.members.map(m => m.userId).sort()).toEqual([a.owner.userId, staff.userId].sort())
    expect(team.members.find(m => m.userId === a.owner.userId)).toMatchObject({ role: 'OWNER', source: 'ORG', isSelf: true, canDisable: false })
    expect(team.members.find(m => m.userId === staff.userId)).toMatchObject({ role: 'STAFF', source: 'STORE', status: 'ACTIVE', isSelf: false, canDisable: true })
    expect(team.invitations.map(i => i.email)).toEqual(['cho@example.com'])
    const serialized = JSON.stringify(team)
    expect(serialized).not.toContain(token)
    expect(serialized).not.toMatch(/tokenHash|token_hash/)
  })

  it('flags expired invitations', async () => {
    const a = await createTenant('exp')
    await createInvitationRow(a.store, { email: 'old@example.com', createdBy: a.owner.userId, expiresAt: new Date(Date.now() - 1000) })
    expect((await listTeam(getDb(), ownerCtx(a))).invitations[0]).toMatchObject({ email: 'old@example.com', expired: true })
  })
})

describe('setMemberStatus', () => {
  it('disables a staff member immediately and re-enables them', async () => {
    const a = await createTenant('dis')
    const staff = await addStaff(a.store)
    expect(await findStoreAccess(getDb(), staff.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    await setMemberStatus(getDb(), ownerCtx(a), staff.userId, 'DISABLED')
    expect(await findStoreAccess(getDb(), staff.userId, a.store.id)).toBeNull()
    await setMemberStatus(getDb(), ownerCtx(a), staff.userId, 'ACTIVE')
    expect(await findStoreAccess(getDb(), staff.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
  })

  it('refuses to disable yourself and treats non-members and other stores as NOT_FOUND', async () => {
    const a = await createTenant('self')
    const b = await createTenant('self-b')
    const staffOfB = await addStaff(b.store)
    const stranger = await createUser()
    await expect(setMemberStatus(getDb(), ownerCtx(a), a.owner.userId, 'DISABLED'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'SELF' } })
    for (const target of [staffOfB.userId, stranger.userId, `user_${randomUUID()}`]) {
      await expect(setMemberStatus(getDb(), ownerCtx(a), target, 'DISABLED')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await findStoreAccess(getDb(), staffOfB.userId, b.store.id)).toMatchObject({ role: 'STAFF' })
  })
})

describe('revokeInvitation', () => {
  it('deletes a pending invitation but not accepted or foreign ones', async () => {
    const a = await createTenant('rev')
    const b = await createTenant('rev-b')
    const pending = await createInvitationRow(a.store, { email: 'p@example.com', createdBy: a.owner.userId })
    const accepted = await createInvitationRow(a.store, { email: 'a@example.com', createdBy: a.owner.userId, acceptedAt: new Date() })
    const foreign = await createInvitationRow(b.store, { email: 'f@example.com', createdBy: b.owner.userId })

    await revokeInvitation(getDb(), ownerCtx(a), pending.row.id)
    await expect(revokeInvitation(getDb(), ownerCtx(a), pending.row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(revokeInvitation(getDb(), ownerCtx(a), accepted.row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(revokeInvitation(getDb(), ownerCtx(a), foreign.row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await pendingOf(b.store.id)).toHaveLength(1)
  })
})
