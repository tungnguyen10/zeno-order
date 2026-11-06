import { randomUUID } from 'node:crypto'
import { expect, type Page, type TestInfo } from '@playwright/test'

export const E2E_PASSWORD = 'E2e-Password-123'

export function uniqueStamp(testInfo: TestInfo): string {
  return `${Date.now().toString(36)}${randomUUID().slice(0, 8)}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`
}

/** Real Neon Auth sign-up + onboarding; ends on /app/orders at a 360px viewport. */
export async function signUpAndOnboard(page: Page, testInfo: TestInfo, storeName: string): Promise<{ slug: string, email: string }> {
  const stamp = uniqueStamp(testInfo)
  const email = `e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}@example.com`
  const slug = `e2e-${stamp}`
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill('Chủ Quán E2E')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill(`${storeName} Group`)
  await page.getByLabel('Tên cửa hàng').fill(storeName)
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
  await expect(page.getByTestId('active-store-name')).toHaveText(storeName)
  return { slug, email }
}
