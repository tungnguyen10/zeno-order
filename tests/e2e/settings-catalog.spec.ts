import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

test('owner enables delivery, adds a zone, and cannot turn off the last mode', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Giao Hàng')
  await page.getByRole('link', { name: 'Cài đặt', exact: true }).click()
  await page.getByRole('tab', { name: 'Nhận món & khu vực giao' }).click()
  await expect(page).toHaveURL(/tab=fulfillment/)
  await expectNoHorizontalOverflow(page)

  const publicFulfillment = async () => (await (await page.request.get(`/api/public/stores/${slug}/fulfillment`)).json())

  await page.getByRole('switch', { name: 'Giao hàng' }).click()
  await expect(page.getByText(/Chưa có khu vực giao đang bật/)).toBeVisible()
  await expect.poll(async () => (await publicFulfillment()).modes.delivery).toEqual({ enabled: true, available: false })

  await page.getByLabel('Tên khu vực').fill('Quận 1')
  await page.getByLabel('Phí giao (đ)').fill('15k')
  await page.getByRole('button', { name: 'Thêm khu vực' }).click()
  await expect(page.getByLabel('Sửa tên khu vực')).toHaveValue('Quận 1')
  await expect(page.getByText(/Chưa có khu vực giao đang bật/)).toBeHidden()
  await expect.poll(async () => (await publicFulfillment()).modes.delivery).toEqual({ enabled: true, available: true })
  await expect.poll(async () => (await publicFulfillment()).deliveryZones).toEqual([expect.objectContaining({ name: 'Quận 1', feeVnd: 15000 })])

  await page.getByRole('switch', { name: 'Tại bàn' }).click()
  await page.getByRole('switch', { name: 'Mang đi' }).click()
  await expect(page.getByRole('switch', { name: 'Mang đi' })).not.toBeChecked()
  await page.getByRole('switch', { name: 'Giao hàng' }).click()
  await expect(page.getByText('Cần bật ít nhất một hình thức nhận món', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Giao hàng' })).toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Giao hàng' })).toBeChecked()
})

test('dirty store draft survives dismissed tab and history navigation', async ({ page }, testInfo) => {
  await signUpAndOnboard(page, testInfo, 'Quán Nháp')
  await page.getByRole('link', { name: 'Cài đặt', exact: true }).click()
  const name = page.getByLabel('Tên cửa hàng')
  const original = await name.inputValue()
  await name.fill(`${original} mới`)

  await Promise.all([
    page.waitForEvent('dialog').then(dialog => dialog.dismiss()),
    page.getByRole('tab', { name: 'Nhận món & khu vực giao' }).click(),
  ])
  await expect(page).not.toHaveURL(/tab=fulfillment/)
  await expect(name).toHaveValue(`${original} mới`)

  await Promise.all([
    page.waitForEvent('dialog').then(dialog => dialog.accept()),
    page.getByRole('tab', { name: 'Nhận món & khu vực giao' }).click(),
  ])
  await expect(page).toHaveURL(/tab=fulfillment/)
  await page.getByRole('tab', { name: 'Cửa hàng' }).click()
  await expect(name).toHaveValue(original)

  await name.fill(`${original} nháp`)
  await Promise.all([
    page.waitForEvent('dialog').then(dialog => dialog.dismiss()),
    page.goBack(),
  ])
  await expect(page).not.toHaveURL(/tab=fulfillment/)
  await expect(name).toHaveValue(`${original} nháp`)
})
