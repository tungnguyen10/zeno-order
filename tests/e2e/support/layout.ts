import { expect, type Page } from '@playwright/test'

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0)
}
