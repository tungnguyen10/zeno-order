export function remainingSeconds(expiresAt: string, nowMs: number): number {
  const target = Date.parse(expiresAt)
  if (!Number.isFinite(target) || !Number.isFinite(nowMs)) return 0
  return Math.max(0, Math.ceil((target - nowMs) / 1000))
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
