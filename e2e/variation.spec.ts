import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'

const opera = readFileSync('e2e/fixtures/opera.pgn', 'utf8')
/** After 1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.Nc3, the line tried below instead of 4.dxe5. */
const AFTER_NC3 = 'rn1qkbnr/ppp2ppp/3p4/4p3/3PP1b1/2N2N2/PPP2PPP/R1BQKB1R b KQkq - 1 4'

/** SAN as the page prints it: the figurine is dropped, the letter kept for screen readers stays, the move number goes. */
const sanOf = (text: string) => text.replace(/[\u2654-\u265f\s]/g, '').replace(/^\d+(\.|…)/, '')

const click = async (page: Page, from: string, to: string) => {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
  test.describe(name, () => {
    test.use({ viewport })

    test('tries a line off the game, sees the engine follow it, walks it and returns', async ({ page, axe }) => {
      await page.goto('/#/revisar')
      await page.getByLabel('PGN', { exact: true }).fill(opera)
      await page.getByRole('button', { name: 'Revisar partida' }).click()
      await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 240_000 })

      await page.getByRole('button', { name: /Pretas: Bg4/ }).click()
      await click(page, 'b1', 'c3')
      const nav = page.getByRole('toolbar', { name: 'Navegação da partida' })
      await expect(page.getByRole('heading', { name: 'Variante' })).toBeVisible()
      await expect(nav).toContainText('variante, lance 1 de 1')
      const continuation = page.getByRole('list', { name: 'Melhor continuação' }).getByRole('listitem')
      await expect(continuation.first()).toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('img', { name: /^Avaliação [+-]?\d+,\d: brancas com \d+% de chance$/ })).toBeVisible()

      const arrow = await page.locator('marker[id*="arrowhead"]').getAttribute('id')
      const [from, to] = arrow!.split('-').slice(-2)
      const best = new Chess(AFTER_NC3).move({ from, to, promotion: 'q' }).san
      expect(sanOf(await continuation.first().innerText())).toBe(best)
      await axe()

      await page.getByLabel('Digitar um lance').fill('Bxf3')
      await page.getByLabel('Digitar um lance').press('Enter')
      await expect(nav).toContainText('variante, lance 2 de 2')
      await expect(page.getByRole('list', { name: 'Lances da variante' }).getByRole('button')).toHaveCount(2)
      await page.getByLabel('Digitar um lance').blur()

      await page.keyboard.press('ArrowLeft')
      await expect(nav).toContainText('variante, lance 1 de 2')
      await page.keyboard.press('ArrowRight')
      await expect(nav).toContainText('variante, lance 2 de 2')

      // Two moves into the engine's line from here, played on the board from the card.
      await expect(continuation.nth(1)).toBeVisible({ timeout: 60_000 })
      await continuation.nth(1).getByRole('button').click()
      await expect(nav).toContainText('variante, lance 4 de 4')
      await expect(page.getByRole('list', { name: 'Lances da variante' }).getByRole('button')).toHaveCount(4)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: 'Variante' })).toBeHidden()
      await expect(nav).toContainText('lance 6 de 33')
      await expect(page.getByRole('button', { name: /Pretas: Bg4/ })).toHaveAttribute('aria-current', 'true')

      await click(page, 'd4', 'e5')
      await expect(nav).toContainText('lance 7 de 33')
      await expect(page.getByRole('heading', { name: 'Variante' })).toBeHidden()
    })
  })
}
