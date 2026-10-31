import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

const PASSWORD = 'E2e-Password-123'

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

/** Points 22px above and below the control's centre must still hit it (≥44px tall hit area). */
async function expectHitArea(locator: Locator) {
  await expect(locator).toBeVisible()
  const hits = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    return [y - 22, y + 22].map(py => document.elementFromPoint(x, py)?.closest('[role="switch"]') === el)
  })
  expect(hits).toEqual([true, true])
}

function uniqueStamp(testInfo: TestInfo, tag = ''): string {
  return `${Date.now().toString(36)}${tag}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`
}

/** Client-side navigation, so in-memory Nuxt state survives (unlike page.goto). */
async function clientNavigate(page: Page, path: string) {
  await page.evaluate((to) => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push: (p: string) => Promise<unknown> } } } } }).__vue_app__
    return app.config.globalProperties.$router.push(to)
  }, path)
}

async function fillSignUp(page: Page, name: string, email: string) {
  await page.getByLabel('Tên của bạn').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
}

async function onboard(page: Page, storeName: string, slug: string) {
  await page.getByLabel('Tên doanh nghiệp').fill(`${storeName} Group`)
  await page.getByLabel('Tên cửa hàng').fill(storeName)
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
  await expect(page.getByTestId('active-store-name')).toHaveText(storeName)
}

test('visitor is redirected to login with a return path', async ({ page }) => {
  await page.goto('/app/settings')
  await expect(page).toHaveURL(/\/login\?redirect=\/app\/settings$/)
})

test('owner signs up, onboards, edits settings, survives reload and signs out', async ({ page }, testInfo) => {
  const stamp = `${Date.now().toString(36)}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`
  const email = `e2e+${stamp}@example.com`
  const slug = `e2e-${stamp}`

  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill('Chủ Quán E2E')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill('E2e-Password-123')
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()

  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill('E2E Group')
  await page.getByLabel('Tên cửa hàng').fill('Trà Sữa E2E')
  await expect(page.getByLabel('Đường dẫn cửa hàng')).toHaveValue('tra-sua-e2e')
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()

  await expect(page).toHaveURL(/\/app\/orders$/)
  await expect(page.getByTestId('active-store-name')).toHaveText('Trà Sữa E2E')

  await page.reload()
  await expect(page.getByTestId('active-store-name')).toHaveText('Trà Sữa E2E')

  await page.getByRole('link', { name: 'Cài đặt' }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)
  const accepting = page.getByRole('switch', { name: 'Đang nhận đơn' })
  await expect(accepting).not.toBeChecked()
  await expectTouchTarget(page.locator('label', { hasText: 'Đang nhận đơn' }))
  await expectHitArea(accepting)
  await accepting.click()
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByText('Đã lưu cài đặt', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Đang nhận đơn' })).toBeChecked()

  await expectTouchTarget(page.getByRole('button', { name: 'Đăng xuất' }))
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/app/orders')
  await expect(page).toHaveURL(/\/login\?redirect=/)
})

test('login shows a Vietnamese error for wrong credentials', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('khong-ton-tai@example.com')
  await page.getByLabel('Mật khẩu').fill('Sai-mat-khau-1')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByText('Email hoặc mật khẩu không đúng')).toBeVisible()
})

test('login controls are at least 44px tall', async ({ page }) => {
  await page.goto('/login')
  await expectTouchTarget(page.getByLabel('Email'))
  await expectTouchTarget(page.getByLabel('Mật khẩu'))
  await expectTouchTarget(page.getByRole('button', { name: 'Đăng nhập' }))
  await expectTouchTarget(page.getByRole('link', { name: 'Đăng ký' }))
})

test('switching accounts without signing out never shows the previous user\'s store, and a 401 sends the user to login', async ({ page }, testInfo) => {
  test.slow()
  const stampA = uniqueStamp(testInfo, 'a')
  const stampB = uniqueStamp(testInfo, 'b')

  await page.goto('/signup')
  await fillSignUp(page, 'Chủ Quán A', `e2e+${stampA}@example.com`)
  await onboard(page, 'Quán A E2E', `e2e-${stampA}`)

  await clientNavigate(page, '/signup')
  await fillSignUp(page, 'Chủ Quán B', `e2e+${stampB}@example.com`)
  await expect(page.getByRole('button', { name: 'Tạo cửa hàng' })).toBeVisible()
  await expect(page).toHaveURL(/\/onboarding$/)
  await onboard(page, 'Quán B E2E', `e2e-${stampB}`)

  await page.route('**/api/stores/**', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Phiên đăng nhập đã hết hạn' }),
  }))
  await page.getByRole('link', { name: 'Cài đặt' }).click()
  await expect(page).toHaveURL(/\/login\?redirect=(\/|%2F)app(\/|%2F)settings$/)
  await page.unroute('**/api/stores/**')

  // Neon Auth rate-limits sign-in, so recover via the still-valid session cookie instead of signing in again.
  await page.goto('/app/settings')
  await expect(page.getByTestId('active-store-name')).toHaveText('Quán B E2E')
  await expect(page.getByLabel('Tên cửa hàng')).toHaveValue('Quán B E2E')
})
