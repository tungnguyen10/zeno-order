import { expect, vi } from 'vitest'

export function captureConsole() {
  const lines: string[] = []
  const push = (...args: unknown[]) => {
    lines.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
  }
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method).mockImplementation(push))
  return {
    text: () => lines.join('\n'),
    restore: () => spies.forEach(spy => spy.mockRestore()),
  }
}

/** Fails without printing the needle itself, so a leaked secret never lands in the test report. */
export function expectNoneOf(haystack: string, needles: string[]): void {
  needles.forEach((needle, index) => {
    expect(haystack.includes(needle), `needle #${index} leaked`).toBe(false)
  })
}
