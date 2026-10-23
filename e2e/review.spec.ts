import { readFileSync } from 'node:fs'
import { expect, test } from './test.ts'

const scholar = readFileSync('e2e/fixtures/scholar.pgn', 'utf8')
const opera = readFileSync('e2e/fixtures/opera.pgn', 'utf8')

async function setUsername(page: import('@playwright/test').Page, name: string) {
  await page.goto('/#/config')
  await page.getByLabel('Lichess').fill(name)
  await page.getByLabel('Lichess').blur()
}

async function review(page: import('@playwright/test').Page, pgn: string) {
  await page.goto('/#/revisar')
  await page.getByLabel('PGN', { exact: true }).fill(pgn)
  await page.getByRole('button', { name: 'Revisar partida' }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 240_000 })
}

test('reviews a pasted game with Stockfish 19 and explains the blunder', async ({ page, axe }) => {
  await setUsername(page, 'gabrielhom')
  await review(page, scholar)

  const summary = page.getByLabel('Resumo')
  await expect(summary).toContainText('você')
  await expect(summary).toContainText("King's Pawn Game")
  await expect(summary.getByRole('row', { name: /Blunder/ })).toHaveText(/Blunder\s*0\s*1/)

  await page.getByRole('button', { name: 'Pretas: Nf6, Blunder' }).click()
  await expect(page.getByText(/^O melhor era /)).toBeVisible()
  await expect(page.getByLabel('Melhor sequência').first()).toBeVisible()
  await axe()
})

test('shows accuracy for both sides of a longer game and walks it by keyboard', async ({ page, axe }) => {
  await review(page, opera)

  const accuracies = await page.getByLabel('Resumo').getByText(/^\d+(,\d)?%$/).allInnerTexts()
  expect(accuracies).toHaveLength(2)
  const [white, black] = accuracies.map((t) => Number.parseFloat(t.replace(',', '.')))
  expect(white).toBeGreaterThan(black)
  expect(white).toBeGreaterThan(85)

  await page.keyboard.press('End')
  await expect(page.getByRole('button', { name: /Brancas: Rd8#/ })).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: /Pretas: Nxb8/ })).toHaveAttribute('aria-current', 'true')
  await axe()
})

test('lists reviewed games in the history after a reload', async ({ page, axe }) => {
  await setUsername(page, 'gabrielhom')
  await review(page, scholar)
  await page.goto('/#/historico')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Histórico' })).toBeVisible()
  await expect(page.getByRole('link', { name: /vs Oponente.*\d+(,\d)?% sua precisão/ })).toBeVisible()
  await axe()
})
