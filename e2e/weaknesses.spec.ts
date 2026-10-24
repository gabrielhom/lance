import { readFileSync } from 'node:fs'
import { expect, test } from './test.ts'

const opera = readFileSync('e2e/fixtures/opera.pgn', 'utf8')

test('reports the weak points of my reviewed games, each with an action that opens it', async ({ page, axe }) => {
  test.setTimeout(360_000)
  await page.goto('/#/config')
  await page.getByLabel('Lichess').fill('Duke Karl / Count Isouard')
  await page.getByLabel('Lichess').blur()
  await page.goto('/#/revisar')
  await page.getByLabel('PGN', { exact: true }).fill(opera)
  await page.getByRole('button', { name: 'Revisar partida' }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 240_000 })

  await page.goto('/#/historico')
  await page.getByRole('link', { name: 'Ver seus pontos fracos' }).click()
  await expect(page.getByRole('heading', { name: 'Seus pontos fracos' })).toBeVisible()
  await expect(page.getByText('Tirado de 1 partida sua revisada.')).toBeVisible()

  // One game is a fact to show, not a verdict.
  const opening = page.getByRole('list', { name: 'Aberturas' }).getByRole('listitem').filter({ hasText: 'Philidor Defense' })
  await expect(opening).toContainText('de pretas')
  await expect(opening).toContainText('Poucos jogos ainda')
  await expect(opening).toContainText(/1 partida · C41 · 0% dos pontos · precisão \d+,\d/)
  const middlegame = page.getByRole('list', { name: 'Fases' }).getByRole('listitem').filter({ hasText: 'Meio de jogo' })
  await expect(middlegame).toContainText('Poucos jogos ainda')
  await expect(middlegame).toContainText(/1 partida · precisão \d+,\d · à frente de \d+% dos jogadores do Lichess · \d+(,\d)? erros por partida/)
  await expect(page.getByRole('region', { name: 'Por onde começar' })).toContainText('Poucos jogos ainda para apontar um ponto fraco.')
  await expect(page.getByRole('region', { name: 'Erros por partida' })).toContainText('0 de 1Derrotas com blunder')
  await axe()

  await middlegame.getByRole('link', { name: /^Rever o meio de jogo contra Paul Morphy, precisão \d+,\d$/ }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /Brancas: Bg5/ })).toHaveAttribute('aria-current', 'true')

  await page.goBack()
  await opening.getByRole('link', { name: 'Treinar as 2 posições dessas partidas' }).click()
  await expect(page).toHaveURL(/#\/treino\/pgn%3A/)
  await expect(page.getByRole('region', { name: 'Lance 9 das pretas·1 de 2' })).toBeVisible()
  await expect(page.getByLabel('Digitar um lance')).toBeVisible()
})
