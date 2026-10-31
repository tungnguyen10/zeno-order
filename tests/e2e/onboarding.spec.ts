import { expect, test, type Locator } from '@playwright/test'

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
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
