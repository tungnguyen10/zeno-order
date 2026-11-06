import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function discoverRoutes(dir = 'server/api'): { file: string, method: string, path: string, guard: string | null }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) return discoverRoutes(file)
    const match = file.match(/\.(get|post|put|patch|delete)\.ts$/)
    if (!match) return []
    const source = readFileSync(file, 'utf8')
    return [{ file, method: match[1]!.toUpperCase(), path: file.replace(/^server/, '').replace(/\.(get|post|put|patch|delete)\.ts$/, '').replace(/\/index$/, '').replace(/\[(\w+)\]/g, ':$1'), guard: source.match(/await (requireStoreOwner|requireStoreStaff|requireOrgOwner)\(/)?.[1] ?? null }]
  })
}
