import webpush from 'web-push'

/** Web Push is optional: it stays off until all three VAPID env vars are present. */
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)
}

let configured = false

export function configureVapid(): void {
  if (configured) return
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)
  configured = true
}

export { webpush }
