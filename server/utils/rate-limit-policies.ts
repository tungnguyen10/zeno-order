export const RATE_POLICIES = {
  checkout: { limit: 10, windowSec: 600 }, // per store + IP; idempotent replays exempt
  tracking: { limit: 40, windowSec: 60 }, // per capability; separate high IP ceiling
  trackingIp: { limit: 2000, windowSec: 60 },
  menu: { limit: 120, windowSec: 60 }, // permits 30 simultaneous guests on café Wi-Fi
  webhook: { limit: 600, windowSec: 60 },
  webhookFailure: { limit: 20, windowSec: 600 },
} as const
