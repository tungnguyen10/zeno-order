export function formatAge(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'Vừa xong'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  return `${Math.floor(hours / 24)} ngày trước`
}
