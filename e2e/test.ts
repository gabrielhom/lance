import { test as base, chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Playwright's bundled Chromium needs system libraries this WSL box lacks, so CDP_URL lets the suite drive the host Chrome.
export const test = base.extend<{ axe: () => Promise<void> }, object>({
  browser: [
    async ({ playwright }, provide) => {
      const cdp = process.env.CDP_URL
      const browser = cdp ? await chromium.connectOverCDP(cdp) : await playwright.chromium.launch()
      await provide(browser)
      await browser.close()
    },
    { scope: 'worker' },
  ],
  axe: async ({ page }, provide) => {
    await provide(async () => {
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  },
})
export { expect }
