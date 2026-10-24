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

test('lists the moves in sections that jump the board to the start of each phase', async ({ page, axe }) => {
  await page.goto('/#/revisar')
  await page.getByLabel('PGN', { exact: true }).fill(opera)
  await page.getByRole('button', { name: 'Revisar partida' }).click()

  // The sections show while the review still runs, without accuracy.
  const list = page.getByRole('table', { name: 'Lista de lances' })
  await expect(list.getByRole('columnheader', { name: 'Abertura' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 240_000 })

  await expect(list.getByRole('columnheader')).toHaveText(['Nº', 'Brancas', 'Pretas', /^Abertura/, /^Meio de jogo/, /^Final/])
  await expect(list.getByRole('columnheader', { name: /^Abertura/ })).toHaveText(/^Abertura Precisão: brancas \d+,\d · pretas \d+,\d$/)
  await expect(list.getByRole('columnheader', { name: /^Final/ })).toHaveText('Final Precisão: brancas – · pretas –')

  const nav = page.getByRole('group', { name: 'Ir para a fase' })
  await expect(nav.getByRole('button', { name: 'Abertura' })).toHaveAttribute('aria-current', 'true')
  await nav.getByRole('button', { name: 'Meio de jogo' }).click()
  await expect(nav.getByRole('button', { name: 'Meio de jogo' })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByText('lance 17 de 33')).toBeVisible()
  await expect(list.locator('button[aria-current="true"]')).toHaveAccessibleName(/^Brancas: Bg5/)
  const section = list.locator('tr.sect').filter({ hasText: 'Meio de jogo' })
  await expect(section.locator('xpath=following-sibling::tr[1]')).toContainText('9.♝Bg5')
  // The endgame starts on Black's 16th move, so that row opens the section as "16. … Nxb8".
  await nav.getByRole('button', { name: 'Final' }).click()
  await expect(page.getByText('lance 32 de 33')).toBeVisible()
  await expect(list.locator('tr.sect').filter({ hasText: 'Final' }).locator('xpath=following-sibling::tr[1]')).toHaveText('16.…♞Nxb8')
  await expect(list.locator('tr.sect').filter({ hasText: 'Final' }).locator('xpath=preceding-sibling::tr[1]')).toHaveText(/^16\.♛Qb8\+/)
  await axe()
})
