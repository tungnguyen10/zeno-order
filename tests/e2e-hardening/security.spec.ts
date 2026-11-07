import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { closeDb } from '../../server/db/client'
import { createOptionGroup, createProduct, createTenant } from '../support/fixtures'
import { assertTestDatabase } from '../support/test-env'
import { openStore } from '../support/checkout-fixtures'

// CSP observations use DOM markers and native callbacks. Main-world
// waitForFunction/evaluate inject eval through Playwright's UtilityScript.
async function observeApplication(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const marker = document.createElement('meta')
      marker.name = 'e2e-csp-violation'
      marker.content = JSON.stringify({ directive: event.effectiveDirective, blockedURI: event.blockedURI, source: event.sourceFile, line: event.lineNumber })
      document.documentElement.append(marker)
    })
    const measure = () => {
      if (document.documentElement) document.documentElement.dataset.e2eOverflow = String(document.documentElement.scrollWidth > window.innerWidth)
      requestAnimationFrame(measure)
    }
    requestAnimationFrame(measure)
  })
}

async function analyzeAccessibility(page: import('@playwright/test').Page) {
  // Axe still runs under the same enforced CSP in a separate document.
  const auditPage = await page.context().newPage()
  try {
    const viewport = page.viewportSize()
    if (viewport) await auditPage.setViewportSize(viewport)
    await auditPage.goto(page.url())
    await expect(auditPage.locator('main')).toBeVisible()
    return await new AxeBuilder({ page: auditPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  }
  finally { await auditPage.close() }
}

assertTestDatabase()
test.afterAll(closeDb)
for (const path of ['/login', '/signup', '/o/unknown-order-capability']) {
  test(`production a11y/CSP/viewport ${path}`, async ({ page }) => {
    const violations: string[] = []
    await observeApplication(page)
    page.on('pageerror', error => violations.push(error.name))
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
    // These routes render only on the client (ssr:false); visible main confirms client rendering.
    if (path.startsWith('/o/')) await expect(page.getByRole('heading', { name: 'Không tìm thấy đơn hàng' })).toBeVisible()
    const results = await analyzeAccessibility(page)
    expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
    await expect(page.locator('meta[name="e2e-csp-violation"]')).toHaveCount(0)
    expect(violations).toEqual([])
    await expect(page.locator('html')).toHaveAttribute('data-e2e-overflow', 'false')
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
  await observeApplication(page)
  await signUpAndOnboard(page, info, 'Quán Hardening')
  if (info.project.name === 'desktop-chrome') await page.setViewportSize({ width: 1365, height: 900 })
  await expect(page.getByTestId('active-store-name')).toHaveText('Quán Hardening')
  const results = await analyzeAccessibility(page)
  expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
  await expect(page.locator('meta[name="e2e-csp-violation"]')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-e2e-overflow', 'false')
})

// A negative control ensures the observer is active and the policy remains enforced.
test('CSP observer catches a rejected application script', async ({ page }) => {
  await observeApplication(page)
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const script = document.createElement('script')
      script.src = 'https://blocked.invalid/e2e-csp-control.js'
      document.head.append(script)
    })
  })
  await page.goto('/login')
  const violations = page.locator('meta[name="e2e-csp-violation"]')
  await expect(violations).toHaveCount(1)
  await expect(violations).toHaveAttribute('content', /blocked\.invalid/)
})
