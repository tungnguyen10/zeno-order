import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeDb } from '../../server/db/client'
import { expectNoHorizontalOverflow } from './support/layout'
import { PASSWORD, countEvents, seedCodOrder, signUpAndOnboard, stampOf } from './support/flows'

test.afterAll(async () => {
  await closeDb()
})

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  await expect.poll(async () => (await locator.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
}

const card = (page: Page, code: string) => page.getByTestId(`order-card-${code}`)
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name })

test('owner and staff serve a COD order end to end', async ({ browser }, testInfo) => {
  test.slow()
  const stamp = stampOf(testInfo)
  const slug = `ops-${stamp}`
  const staffEmail = `e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}staff@example.com`
  const context = { viewport: { width: 360, height: 740 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', baseURL: testInfo.project.use.baseURL }
  const ownerContext = await browser.newContext(context)
  const staffContext = await browser.newContext(context)
  const owner = await ownerContext.newPage()
  const staff = await staffContext.newPage()

  await signUpAndOnboard(owner, { name: 'Chủ Quán Ops', email: `e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}owner@example.com`, storeName: 'Quán Ops', slug })

  // Hai đơn COD vừa vào quán.
  const orderA = await seedCodOrder(slug, { fulfillmentType: 'PICKUP', totalVnd: 60_000, subtotalVnd: 60_000 })
  const orderB = await seedCodOrder(slug, { fulfillmentType: 'DINE_IN', totalVnd: 45_000, subtotalVnd: 45_000 })
  await owner.reload()

  // Một chạm để chuyển đơn sang bước tiếp theo.
  await expect(card(owner, orderA.publicCode)).toBeVisible()
  await expect(tab(owner, /^Mới\s*2/)).toBeVisible()
  const start = card(owner, orderA.publicCode).getByRole('button', { name: 'Bắt đầu làm' })
  await expectTouchTarget(start)
  await expectNoHorizontalOverflow(owner)
  await start.click()
  await expect(card(owner, orderA.publicCode)).toHaveCount(0)
  await expect(tab(owner, /^Mới\s*1/)).toBeVisible()
  await tab(owner, /^Đang làm/).click()
  await expect(card(owner, orderA.publicCode).getByRole('button', { name: 'Đã xong' })).toBeVisible()

  // Mời nhân viên: link hiện một lần.
  await owner.goto('/app/team')
  await owner.getByLabel('Email nhân viên').fill(staffEmail)
  await owner.getByRole('button', { name: 'Tạo lời mời' }).click()
  const inviteUrl = await owner.getByLabel('Link lời mời').inputValue()
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
  await owner.reload()
  await expect(owner.getByTestId('invite-result')).toHaveCount(0)
  await expect(owner.getByText(staffEmail)).toBeVisible()

  // Nhân viên đăng ký qua link mời (không bị đẩy vào onboarding) rồi tham gia quán.
  const invitePath = new URL(inviteUrl).pathname
  await staff.goto(`/signup?redirect=${encodeURIComponent(invitePath)}`)
  await staff.getByLabel('Tên của bạn').fill('Nhân Viên Ops')
  await staff.getByLabel('Email').fill(staffEmail)
  await staff.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await staff.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(staff).toHaveURL(new RegExp(`${invitePath}$`))
  await expect(staff.getByTestId('invite-store-name')).toHaveText('Quán Ops')
  await staff.getByRole('button', { name: 'Tham gia quán' }).click()
  await expect(staff).toHaveURL(/\/app\/orders$/)
  await expect(staff.getByTestId('active-store-name')).toHaveText('Quán Ops')
  await expect(staff.getByRole('link', { name: 'Nhân viên', exact: true })).toHaveCount(0)
  await staff.goto('/app/team')
  await expect(staff.getByText('Chỉ chủ cửa hàng mới quản lý được nhân viên.')).toBeVisible()

  // Review Focus #9: hai người cùng bấm một đơn, một người thắng, người kia thấy báo và danh sách được tải lại.
  await owner.goto('/app/orders')
  await staff.goto('/app/orders')
  await expect(card(owner, orderB.publicCode)).toBeVisible()
  await expect(card(staff, orderB.publicCode)).toBeVisible()
  const boardPoll = /\/api\/stores\/[^/]+\/orders\?/
  await staff.route(boardPoll, route => route.abort()) // giữ màn hình nhân viên "cũ"
  // Card removal is optimistic; wait for the owner's commit before using the staff's stale state.
  const ownerAdvanced = owner.waitForResponse(res => res.url().includes(`/${orderB.id}/status`) && res.status() === 200)
  await card(owner, orderB.publicCode).getByRole('button', { name: 'Bắt đầu làm' }).click()
  await ownerAdvanced
  await expect(card(owner, orderB.publicCode)).toHaveCount(0)

  const conflict = staff.waitForResponse(res => res.url().includes('/status') && res.status() === 409)
  await card(staff, orderB.publicCode).getByRole('button', { name: 'Bắt đầu làm' }).click()
  await conflict
  await expect(staff.getByText('Đơn vừa được người khác cập nhật')).toBeVisible()
  await expect(staff.getByText('Không cập nhật được, đang thử lại…')).toBeVisible() // poll lỗi: giữ danh sách cũ + cảnh báo
  await staff.unroute(boardPoll)
  await expect(card(staff, orderB.publicCode)).toHaveCount(0, { timeout: 15_000 })
  await expect(staff.getByText('Không cập nhật được, đang thử lại…')).toHaveCount(0)
  await tab(staff, /^Đang làm/).click()
  await expect(card(staff, orderB.publicCode)).toBeVisible()
  expect(await countEvents(orderB.id)).toBe(1)

  // Thu tiền mặt rồi hủy: staff không được hủy đơn đã thu, owner thì được và đơn thành "Cần hoàn tiền".
  const staffDialog = staff.getByRole('dialog')
  await card(staff, orderA.publicCode).getByRole('button', { name: /Xem chi tiết đơn/ }).click()
  await staffDialog.getByRole('button', { name: 'Đã thu tiền mặt' }).click()
  await expect(staffDialog.getByText(/Đã thu 60\.000đ bằng tiền mặt/)).toBeVisible()
  await expect(staffDialog.getByText('Đơn đã thu tiền — chỉ chủ quán được hủy')).toBeVisible()
  await expect(staffDialog.getByRole('button', { name: 'Hủy đơn' })).toHaveCount(0)
  await staff.keyboard.press('Escape')

  await owner.reload()
  await tab(owner, /^Đang làm/).click()
  const ownerDialog = owner.getByRole('dialog')
  await card(owner, orderA.publicCode).getByRole('button', { name: /Xem chi tiết đơn/ }).click()
  await ownerDialog.getByRole('button', { name: 'Hủy đơn' }).click()
  await expect(ownerDialog.getByRole('button', { name: 'Xác nhận hủy đơn' })).toBeDisabled()
  await ownerDialog.getByRole('button', { name: 'Hết nguyên liệu' }).click()
  await ownerDialog.getByRole('button', { name: 'Xác nhận hủy đơn' }).click()
  await expect(ownerDialog.getByText('Đã hủy — Hết nguyên liệu')).toBeVisible()
  await expect(ownerDialog.getByText('Cần hoàn tiền').first()).toBeVisible()
  await owner.keyboard.press('Escape')
  await tab(owner, /^Khác/).click()
  await expect(card(owner, orderA.publicCode)).toBeVisible()

  // Báo cáo: owner thấy xu hướng, staff chỉ thấy "Hôm nay"; không tràn ngang ở 360px.
  await owner.goto('/app/reports')
  await expect(owner.getByRole('heading', { name: /Hôm nay/ })).toBeVisible()
  await expect(owner.getByRole('heading', { name: 'Xu hướng' })).toBeVisible()
  await expectNoHorizontalOverflow(owner)
  await staff.goto('/app/reports')
  await expect(staff.getByRole('heading', { name: /Hôm nay/ })).toBeVisible()
  await expect(staff.getByRole('heading', { name: 'Xu hướng' })).toHaveCount(0)

  // Khóa nhân viên có hiệu lực ngay: lần tải sau họ không còn quán nào.
  await owner.goto('/app/team')
  await owner.getByTestId(`member-${staffEmail}`).getByRole('button', { name: 'Khóa' }).click()
  await expect(owner.getByTestId(`member-${staffEmail}`).getByText('Đã khóa')).toBeVisible()
  await staff.goto('/app/orders')
  await expect(staff).toHaveURL(/\/onboarding$/)

  await ownerContext.close()
  await staffContext.close()
})

test('an invitation link used with the wrong account is rejected and stays usable', async ({ browser }, testInfo) => {
  test.slow()
  const stamp = stampOf(testInfo, 'w')
  const slug = `ops-wrong-${stamp}`
  const context = { viewport: { width: 360, height: 740 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', baseURL: testInfo.project.use.baseURL }
  const ownerContext = await browser.newContext(context)
  const strangerContext = await browser.newContext(context)
  const owner = await ownerContext.newPage()
  const stranger = await strangerContext.newPage()

  await signUpAndOnboard(owner, { name: 'Chủ Quán W', email: `e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}owner@example.com`, storeName: 'Quán W', slug })
  await owner.goto('/app/team')
  await owner.getByLabel('Email nhân viên').fill(`e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}right@example.com`)
  await owner.getByRole('button', { name: 'Tạo lời mời' }).click()
  const invitePath = new URL(await owner.getByLabel('Link lời mời').inputValue()).pathname

  await stranger.goto(`/signup?redirect=${encodeURIComponent(invitePath)}`)
  await stranger.getByLabel('Tên của bạn').fill('Người Lạ')
  await stranger.getByLabel('Email').fill(`e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}stranger@example.com`)
  await stranger.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await stranger.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(stranger).toHaveURL(new RegExp(`${invitePath}$`))
  await expect(stranger.getByText('Email không khớp với lời mời')).toBeVisible()
  await expect(stranger.getByRole('button', { name: 'Tham gia quán' })).toBeDisabled()

  // Lời mời vẫn còn hiệu lực cho người đúng email.
  await owner.reload()
  await expect(owner.getByText(`e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}right@example.com`)).toBeVisible()

  await ownerContext.close()
  await strangerContext.close()
})
