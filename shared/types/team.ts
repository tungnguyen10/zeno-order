import type { StoreSummary } from './identity'

export interface TeamMember {
  userId: string
  email: string
  displayName: string | null
  role: 'OWNER' | 'STAFF'
  status: 'ACTIVE' | 'DISABLED'
  source: 'ORG' | 'STORE'
  isSelf: boolean
  canDisable: boolean
}

export interface TeamInvitation {
  id: string
  email: string
  expiresAt: string
  expired: boolean
  createdAt: string
}

export interface TeamResponse {
  members: TeamMember[]
  invitations: TeamInvitation[]
}

export interface CreatedInvitation {
  invitation: TeamInvitation
  inviteUrl: string
}

export interface InvitationPreview {
  storeName: string
  role: 'OWNER' | 'STAFF'
  emailHint: string
  expiresAt: string
  emailMatches: boolean
  emailVerified: boolean
}

export interface AcceptInvitationResult {
  store: StoreSummary
}
