export function tableTokenFromQuery(value: string | null | (string | null)[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  return value === undefined ? undefined : ''
}
