import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicOutputDirectory = fileURLToPath(new URL('../.output/public/', import.meta.url))
const explicitSecret = process.env.NUXT_SUPABASE_SECRET_KEY
const forbiddenValues = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'NUXT_SUPABASE_SECRET_KEY',
  ...(explicitSecret ? [explicitSecret] : []),
]
const searchableExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs'])

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  }))

  return files.flat()
}

const files = await collectFiles(publicOutputDirectory)

for (const file of files) {
  if (!searchableExtensions.has(extname(file))) {
    continue
  }

  const content = await readFile(file, 'utf8')
  const forbiddenValue = forbiddenValues.find(value => content.includes(value))
  if (forbiddenValue) {
    throw new Error(`Client output contains a server-only Supabase secret marker: ${file}`)
  }
}

console.log(`Checked ${files.length} client output files: no server-only Supabase secret found.`)
