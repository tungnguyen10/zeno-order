import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

test('owner adds products quickly, validates price, and toggles availability', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Thực Đơn')
  await page.getByRole('link', { name: 'Thực đơn', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/menu$/)
  await expect(page.getByText('Chưa có món nào')).toBeVisible()
  await page.getByLabel('Tên món').fill('Trà sữa trân châu')
  await page.getByLabel('Giá (đ)').fill('35k')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' })
  await expect(row.getByText('35.000đ')).toBeVisible()
  await expect(page.getByLabel('Tên món')).toHaveValue('')
  await expect(page.getByLabel('Tên món')).toBeFocused()

  await page.getByLabel('Tên món').fill('Món lỗi')
  await page.getByLabel('Giá (đ)').fill('abc')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByText(/Nhập giá hợp lệ/)).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Món lỗi' })).toHaveCount(0)
  await page.getByLabel('Giá (đ)').fill('42.000')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Món lỗi' }).getByText('42.000đ')).toBeVisible()

  await page.getByLabel('Tên món').fill('Cà phê muối')
  await page.getByLabel('Giá (đ)').fill('25000')
  await page.getByRole('button', { name: 'Thêm món' }).dblclick()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cà phê muối' })).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cà phê muối' })).toHaveCount(1)
  const soldOut = page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' })
  await soldOut.getByRole('switch', { name: 'Còn hàng' }).click()
  await expect(soldOut.getByRole('switch', { name: 'Còn hàng' })).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' }).getByRole('switch', { name: 'Còn hàng' })).not.toBeChecked()
  await expectNoHorizontalOverflow(page)
  await page.goto(`/s/${slug}`)
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' }).getByText('Hết hàng')).toBeVisible()
})

test('owner creates a category and files a product under it', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Danh Mục')
  await page.goto('/app/menu')
  await page.getByLabel('Tên danh mục').fill('Trà sữa')
  await page.getByRole('button', { name: 'Thêm danh mục' }).click()
  await page.getByLabel('Danh mục của món').click()
  await page.getByRole('option', { name: 'Trà sữa' }).click()
  await page.getByLabel('Tên món').fill('Trà sữa matcha')
  await page.getByLabel('Giá (đ)').fill('39k')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Trà sữa' })).toBeVisible()
  await page.goto(`/s/${slug}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Trà sữa' })).toBeVisible()
  await expect(page.getByText('39.000đ')).toBeVisible()
})

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('owner configures size options and an image, and the public menu reflects both', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Option')
  await page.goto('/app/menu')
  await page.getByLabel('Tên món').fill('Trà sữa')
  await page.getByLabel('Giá (đ)').fill('30k')
  await page.getByRole('button', { name: 'Thêm món' }).click()

  await page.getByRole('button', { name: 'Sửa Trà sữa' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Thêm nhóm option' }).click()
  await dialog.getByLabel('Tên nhóm').fill('Size')
  await dialog.getByLabel('Tên lựa chọn').first().fill('M')
  await dialog.getByRole('button', { name: 'Thêm lựa chọn' }).click()
  await dialog.getByLabel('Tên lựa chọn').nth(1).fill('L')
  await dialog.getByLabel('Giá cộng thêm').nth(1).fill('5k')

  await dialog.locator('input[type=file]').setInputFiles({ name: 'tra-sua.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await expect(dialog.getByRole('img', { name: 'Ảnh món' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Lưu món' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa' }).locator('img')).toBeVisible()

  await page.getByRole('button', { name: 'Sửa Trà sữa' }).click()
  await expect(page.getByRole('dialog').getByLabel('Tên nhóm')).toHaveValue('Size')
  await page.keyboard.press('Escape')

  const menu = await (await page.request.get(`/api/public/stores/${slug}/menu`)).json()
  const product = menu.products[0]
  expect(product.imageUrl).toMatch(/\.png$/)
  expect(product.optionGroups[0]).toMatchObject({ name: 'Size', required: true, minSelect: 1, maxSelect: 1 })
  expect(product.optionGroups[0].values.map((v: { name: string, priceDeltaVnd: number }) => [v.name, v.priceDeltaVnd])).toEqual([['M', 0], ['L', 5000]])
})

test('a text file renamed .png is rejected by the editor upload and nothing is stored', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Ảnh Giả')
  await page.goto('/app/menu')
  await page.getByLabel('Tên món').fill('Cà phê')
  await page.getByLabel('Giá (đ)').fill('25k')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await page.getByRole('button', { name: 'Sửa Cà phê' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(page.getByText('Chỉ nhận ảnh JPG, PNG hoặc WebP')).toBeVisible()
  await expect(dialog.getByRole('img', { name: 'Ảnh món' })).toHaveCount(0)
  const menu = await (await page.request.get(`/api/public/stores/${slug}/menu`)).json()
  expect(menu.products[0].imageUrl).toBeNull()
})
