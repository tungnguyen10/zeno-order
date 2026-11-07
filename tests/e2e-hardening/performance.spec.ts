import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import lighthouse from 'lighthouse'
import { createProduct, createTenant } from '../support/fixtures'
import { closeDb } from '../../server/db/client'
import { assertTestDatabase } from '../support/test-env'
import { browserBaseUrl, browserTls } from '../support/browser-production'

assertTestDatabase()
test.afterAll(closeDb)
test('public menu Lighthouse mobile budget on production build', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'mobile-chrome', 'Lighthouse uses Chromium mobile emulation once')
  const tenant = await createTenant('lighthouse')
  await createProduct(tenant.store, { name: 'Trà sữa thử nghiệm' })
  const browser = await playwright.chromium.launch({ args: ['--remote-debugging-port=9222', ...(browserTls ? ['--ignore-certificate-errors'] : [])] })
  try {
    const result = await lighthouse(`${browserBaseUrl}/s/${tenant.store.slug}`, { port: 9222, output: ['html', 'json'], onlyCategories: ['performance', 'accessibility', 'best-practices'], formFactor: 'mobile', throttlingMethod: 'simulate' })
    if (!result) throw new Error('Lighthouse did not produce a report')
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/lighthouse.html', result.report[0]!)
    writeFileSync('test-results/lighthouse.json', result.report[1]!)
    expect(result.lhr.categories.performance!.score).toBeGreaterThanOrEqual(0.80)
    expect(result.lhr.categories.accessibility!.score).toBeGreaterThanOrEqual(0.95)
    expect(result.lhr.audits['largest-contentful-paint']!.numericValue).toBeLessThanOrEqual(2500)
    expect(result.lhr.audits['cumulative-layout-shift']!.numericValue).toBeLessThanOrEqual(0.1)
    const js = result.lhr.audits['network-requests']!.details
    if (js?.type !== 'table') throw new Error('Network request audit unavailable')
    const urls = [...new Set(js.items.filter(item => item.resourceType === 'Script').map(item => item.url as string))]
    let bytes = 0
    for (const url of urls) {
      const response = await fetch(url)
      expect(response.status).toBe(200)
      bytes += gzipSync(Buffer.from(await response.arrayBuffer())).byteLength
    }
    expect(bytes).toBeLessThanOrEqual(400 * 1024)
  }
  finally { await browser.close() }
})
