// Renders PNG app icons from public/favicon.svg. Run: node scripts/generate-icons.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const targets = [
  ['apple-touch-icon.png', 180, 0],
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.12],
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, pad] of targets) {
  const inner = Math.round(size * (1 - 2 * pad))
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0;background:#8b5e3c;display:grid;place-items:center;height:${size}px">${svg.replace('<svg', `<svg width="${inner}" height="${inner}"`)}</body>`)
  await writeFile(new URL(`../public/${file}`, import.meta.url), await page.screenshot({ type: 'png' }))
}
await browser.close()
