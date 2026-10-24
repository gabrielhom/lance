// node scripts/build-icons.mjs   Renders public/favicon.svg into the PNG icons the web app manifest and iOS ask for.
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const svg = readFileSync('public/favicon.svg', 'base64')
// --paper from src/index.css. A maskable icon is cropped to a circle as small as 80% of its side, so the board sits well inside it.
const paper = '#f3eee3'
const icons = [
  { file: 'icon-192.png', size: 192, inset: 0, background: null },
  { file: 'icon-512.png', size: 512, inset: 0, background: null },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.22, background: paper },
  { file: 'apple-touch-icon.png', size: 180, inset: 0, background: null },
]

mkdirSync('public/icons', { recursive: true })
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage()
for (const { file, size, inset, background } of icons) {
  await page.setViewportSize({ width: size, height: size })
  const side = Math.round(size * (1 - 2 * inset))
  const offset = (size - side) / 2
  await page.setContent(
    `<body style="margin:0;background:${background ?? 'transparent'}"><img src="data:image/svg+xml;base64,${svg}" width="${side}" height="${side}" style="position:absolute;left:${offset}px;top:${offset}px"></body>`,
  )
  await page.locator('img').evaluate((img) => img.decode())
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: background === null })
}
await browser.close()
