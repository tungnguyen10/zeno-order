import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../../app/assets/css/main.css', import.meta.url), 'utf8')

function block(selector: string): Record<string, string> {
  const match = css.match(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)^\\}`, 'm'))
  if (!match) throw new Error(`missing ${selector} block`)
  return Object.fromEntries([...match[1]!.matchAll(/--zeno-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(m => [m[1]!, m[2]!.toLowerCase()]))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const PAIRS: Array<[fg: string, bg: string]> = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-inset'], ['text', 'surface-hover'],
  ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-inset'],
  ['primary', 'bg'], ['primary', 'surface'], ['primary', 'surface-inset'], ['primary', 'surface-hover'],
  ['on-primary', 'primary'], ['on-primary', 'primary-hover'], ['text', 'error-wash'],
]

describe.each([':root', '.dark'])('theme tokens in %s', (selector) => {
  const tokens = block(selector)

  it.each(PAIRS)('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(tokens[fg], `--zeno-${fg}`).toBeDefined()
    expect(tokens[bg], `--zeno-${bg}`).toBeDefined()
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })
})
