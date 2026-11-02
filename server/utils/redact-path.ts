const INVITATION_PATHS = /^(\/(?:api\/invitations|invite)\/)[^/?#]+/

export function redactPath(path: string): string {
  return path.replace(INVITATION_PATHS, '$1[REDACTED]')
}
