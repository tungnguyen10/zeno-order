import type { MeResponse } from '#shared/types/identity'
import type { VerifiedUser } from '../../auth/jwt'
import type { Db } from '../../db/client'
import { listAccessibleStores, listOwnedOrganizations } from '../../repositories/membership'
import { ensureProfile } from './profile'

export async function getMe(db: Db, user: VerifiedUser): Promise<MeResponse> {
  const profile = await ensureProfile(db, user)
  const [organizations, stores] = await Promise.all([
    listOwnedOrganizations(db, user.userId),
    listAccessibleStores(db, user.userId),
  ])
  return {
    user: { id: profile.userId, email: profile.email, displayName: profile.displayName },
    organizations,
    stores,
  }
}
