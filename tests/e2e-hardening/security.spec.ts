import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { closeDb } from '../../server/db/client'
import { createOptionGroup, createProduct, createTenant } from '../support/fixtures'
import { assertTestDatabase } from '../support/test-env'
import { openStore } from '../support/checkout-fixtures'

async function analyzeAccessibility(page: import('@playwright/test').Page) {
  // Keep the app page's CSP listener active. Axe's injected feature probes must
  // run in a separate document so they cannot pollute the app's CSP evidence.
  const auditPage = await page.context().newPage()
  try {
    const viewport = page.viewportSize()
    if (viewport) await auditPage.setViewportSize(viewport)
    await auditPage.goto(page.url())
    await auditPage.waitForFunction(() => !!(document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__)
    return await new AxeBuilder({ page: auditPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  }
  finally { await auditPage.close() }
}

assertTestDatabase()
test.afterAll(closeDb)
for (const path of ['/login', '/signup', '/o/unknown-order-capability']) {
  test(`production a11y/CSP/viewport ${path}`, async ({ page }) => {
    const violations: string[] = []
    await page.addInitScript(() => {
      const target = window as typeof window & { cspViolations: string[] }
      target.cspViolations = []
      document.addEventListener('securitypolicyviolation', event => target.cspViolations.push(event.effectiveDirective))
    })
    page.on('pageerror', error => violations.push(error.name))
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
    // Wait for hydration and async error states, not just static HTML.
    await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__)
    if (path.startsWith('/o/')) await expect(page.getByRole('heading', { name: 'Không tìm thấy đơn hàng' })).toBeVisible()
    const results = await analyzeAccessibility(page)
    expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
    expect(await page.evaluate(() => (window as typeof window & { cspViolations: string[] }).cspViolations)).toEqual([])
    expect(violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
test('menu renders hostile text safely and keeps drawer focus/keyboard behavior', async ({ page }) => {
  const t = await createTenant('browser-hardening')
  const name = '<img src=x onerror="window.XSS=1">'
  const product = await createProduct(t.store, { name })
  await createOptionGroup(t.store, product)
  await openStore(t.store.id)
  await page.addInitScript(() => { (window as typeof window & { XSS: number }).XSS = 0 })
  await page.goto(`/s/${t.store.slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.store.name)
  await page.getByRole('button', { name: new RegExp('img src=x') }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { XSS: number }).XSS)).toBe(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: new RegExp('img src=x') })).toBeFocused()
})
test('login keyboard focus and primary touch target', async ({ page }) => {
  await page.goto('/login')
  const input = page.getByLabel('Email')
  await input.focus()
  await expect(input).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeFocused()
  const rect = await page.getByRole('button', { name: 'Đăng nhập', exact: true }).boundingBox()
  expect(rect!.height).toBeGreaterThanOrEqual(44)
  expect(rect!.width).toBeGreaterThanOrEqual(44)
})

test('authenticated owner board keeps CSP, a11y and touch controls working', async ({ page }, info) => {
  const { signUpAndOnboard } = await import('../e2e/support/owner')
  await page.addInitScript(() => {
    const target = window as typeof window & { cspViolations: string[] }
    target.cspViolations = []
    document.addEventListener('securitypolicyviolation', event => target.cspViolations.push(event.effectiveDirective))
  })
  await signUpAndOnboard(page, info, 'Quán Hardening')
  if (info.project.name === 'desktop-chrome') await page.setViewportSize({ width: 1365, height: 900 })
  await expect(page.getByTestId('active-store-name')).toHaveText('Quán Hardening')
  const results = await analyzeAccessibility(page)
  expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
  expect(await page.evaluate(() => (window as typeof window & { cspViolations: string[] }).cspViolations)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
