import { expect, test } from '@playwright/test'
import { signUpAndOnboard } from './support/owner'

test('owner enables ordering and opens the customer page, one tap each, without leaving /app/orders', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Một Chạm')

  await expect(page.getByText('Quán đang tạm nghỉ — khách không đặt được món')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mở cài đặt' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Bật nhận đơn' }).click()
  await expect(page.getByText('Quán đang tạm nghỉ — khách không đặt được món')).toBeHidden()
  await expect(page.getByText('Đang nhận đơn', { exact: true }).first()).toBeVisible()
  await expect(page).toHaveURL(/\/app\/orders$/)

  const viewLink = page.getByRole('link', { name: 'Xem trang khách' })
  await expect(viewLink).toHaveAttribute('href', `/s/${slug}`)
  const [popup] = await Promise.all([page.waitForEvent('popup'), viewLink.click()])
  await expect(popup).toHaveURL(new RegExp(`/s/${slug}$`))
  await expect(popup.getByRole('heading', { level: 1 })).toHaveText('Quán Một Chạm')
  await expect(popup.getByText('Đang nhận đơn', { exact: true })).toBeVisible()
  await expect(popup.getByText('Menu đang được cập nhật')).toBeVisible()
})
