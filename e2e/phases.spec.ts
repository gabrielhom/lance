import { readFileSync } from 'node:fs'
import { expect, test } from './test.ts'

const opera = readFileSync('e2e/fixtures/opera.pgn', 'utf8')

test('splits a reviewed game into phases with accuracy and an estimated rating for each', async ({ page, axe }) => {
  await page.goto('/#/revisar')
  await page.getByLabel('PGN', { exact: true }).fill(opera)
  await page.getByRole('button', { name: 'Revisar partida' }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 240_000 })

  const cells = (table: string, phase: string) => page.getByRole('table', { name: table }).getByRole('row', { name: new RegExp(`^${phase}`) }).getByRole('cell')
  await expect(cells('Paul Morphy, brancas', 'Abertura')).toHaveText(['8', /^\d+,\d$/, /^~\d{3,4} \d{3,4}–\d{3,4}$/])
  await expect(cells('Paul Morphy, brancas', 'Meio de jogo')).toHaveText(['8', /^\d+,\d$/, /^~\d{3,4} \d{3,4}–\d{3,4}$/])
  // Only Rd8# comes after the last trade: too few moves to score, and the endgame never gets an estimate.
  await expect(cells('Paul Morphy, brancas', 'Final')).toHaveText(['1', '–', '–'])
  await expect(cells('Duke Karl / Count Isouard, pretas', 'Meio de jogo')).toHaveText(['7', /^\d+,\d$/, /^~\d{3,4} \d{3,4}–\d{3,4}$/])

  await expect(page.getByLabel('Resumo').getByText(/^Elo estimado ~\d{3,4} \(\d{3,4}–\d{3,4}\)$/)).toHaveCount(2)
  await expect(page.getByText('Linhas tracejadas marcam onde começam o meio de jogo e o final.')).toBeAttached()
  await axe()
})
