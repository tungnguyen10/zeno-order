import { expect, test } from '@playwright/test'
import { assertTestDatabase, loadEnvFileOverride } from '../support/test-env'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

loadEnvFileOverride('.env.test')
assertTestDatabase()

async function waitForHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null)?.__vue_app__))
}

test('owner sets up a store in a few taps and a customer opens the menu from the table QR', async ({ page, browser }, testInfo) => {
  // The first browser test also starts Nuxt's on-demand modules and a second customer context.
  test.setTimeout(120_000)
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Hành Trình')

  // One tap to accept orders, no navigation.
  await page.getByRole('button', { name: 'Bật nhận đơn' }).click()
  await expect(page.getByText('Quán đang tạm nghỉ — khách không đặt được món')).toBeHidden()
  await expect(page).toHaveURL(/\/app\/orders$/)

  // Quick add: name, price, tap.
  await page.getByRole('link', { name: 'Thực đơn', exact: true }).click()
  await page.getByLabel('Tên món').fill('Trà sữa trân châu')
  await page.getByLabel('Giá (đ)').fill('35k')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' }).getByText('35.000đ')).toBeVisible()

  // A required size group.
  await page.getByRole('button', { name: 'Sửa Trà sữa trân châu' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('button', { name: 'Thêm nhóm option' }).click()
  await editor.getByLabel('Tên nhóm').fill('Size')
  await editor.getByLabel('Tên lựa chọn').first().fill('M')
  await editor.getByRole('button', { name: 'Thêm lựa chọn' }).click()
  await editor.getByLabel('Tên lựa chọn').nth(1).fill('L')
  await editor.getByLabel('Giá cộng thêm').nth(1).fill('5k')
  await editor.getByRole('button', { name: 'Lưu món' }).click()
  await expect(editor).toBeHidden()

  // One table, one tap; read its link from the one-time QR sheet.
  await page.goto('/app/settings')
  await expect(page.getByRole('tab', { name: 'Bàn & QR' })).toBeVisible()
  await page.getByRole('tab', { name: 'Bàn & QR' }).click()
  await page.getByRole('button', { name: 'Thêm bàn' }).click()
  const qrSheet = page.getByRole('dialog')
  await expect(qrSheet.getByRole('img', { name: 'Mã QR Bàn 01' })).toBeVisible()
  const link = new URL(await qrSheet.getByLabel('Link bàn').inputValue())
  await page.keyboard.press('Escape')

  // The customer scans the QR on a phone.
  const customerContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 360, height: 740 } })
  const customer = await customerContext.newPage()
  try {
    await customer.goto(`${link.pathname}${link.search}`)
    await waitForHydration(customer)
    await expect(customer.getByRole('heading', { level: 1 })).toHaveText('Quán Hành Trình')
    await expect(customer.getByText('Đang nhận đơn', { exact: true })).toBeVisible()
    await expect(customer.getByText('Bàn 01', { exact: true })).toBeVisible()
    await customer.getByRole('button', { name: 'Thêm Trà sữa trân châu' }).click()
    const sheet = customer.getByRole('dialog')
    await expect(sheet.getByRole('button', { name: 'Thêm • 35.000đ' })).toBeVisible()
    await sheet.getByText('L', { exact: true }).click()
    await expect(sheet.getByRole('button', { name: 'Thêm • 40.000đ' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Thêm • 40.000đ' }).click()
    await expect(customer.getByText('Giỏ • 1 món')).toBeVisible()
    await expectNoHorizontalOverflow(customer)

    // The shared link (no ?t=) shows the same menu without a table.
    await customer.goto(`/s/${slug}`)
    await waitForHydration(customer)
    await expect(customer.getByText('Bàn 01', { exact: true })).toBeHidden()
    await expect(customer.getByText('Trà sữa trân châu')).toBeVisible()
  }
  finally {
    await customerContext.close()
  }
})
