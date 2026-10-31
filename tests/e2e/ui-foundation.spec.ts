import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/layout'

test.use({ viewport: { width: 360, height: 740 } })

for (const path of ['/', '/login', '/signup']) {
  test(`${path} has no horizontal scroll at 360px`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
}

test('dark mode toggle applies and survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click()
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  await expect(page.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeVisible()
  await page.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).click()
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/)
})

test('headings render Vietnamese diacritics with Fraunces', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible()
  const ok = await page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('600 30px "Fraunces"', 'Đặt món tại bàn ạếởữ')
    return document.fonts.check('600 30px "Fraunces"', 'Đặt món tại bàn ạếởữ')
  })
  expect(ok).toBe(true)
})

test('password field can be revealed without breaking its label', async ({ page }) => {
  await page.goto('/login')
  const password = page.getByLabel('Mật khẩu', { exact: true })
  await password.fill('Bi-mat-123')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Hiện mật khẩu' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('Bi-mat-123')
})
