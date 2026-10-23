import { Chess } from 'chess.js'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'

async function startAgainstLowestLevel(page: Page) {
  await page.goto('/')
  await page.getByText('Iniciante', { exact: true }).click()
  await page.getByText('Brancas', { exact: true }).click()
  await page.getByText('Sem relógio', { exact: true }).click()
  await page.getByRole('button', { name: 'Jogar', exact: true }).click()
}

/** The scoresheet prints figurines and gives screen readers the piece letter, so its text holds both. */
const sanOf = (cell: string) => cell.replace(/[\u2654-\u265f\s]/g, '')

/** Plays up to `count` legal moves as the player, stopping early if the game ends. */
async function playMoves(page: Page, count: number) {
  const over = page.locator('#fim-titulo')
  const myTurn = page.getByText('sua vez', { exact: true })
  const moves = page.getByRole('table', { name: 'Lances da partida' }).locator('.mv')
  for (let n = 0; n < count; n++) {
    await expect(myTurn.or(over)).toBeVisible({ timeout: 60_000 })
    if (await over.isVisible()) return
    const board = new Chess()
    for (const cell of await moves.allInnerTexts()) board.move(sanOf(cell))
    const legal = board.moves()
    await page.getByLabel('Digitar um lance').fill(legal[n % legal.length])
    await page.getByLabel('Digitar um lance').press('Enter')
    // A move that ends the game swaps the scoresheet for the result, so the game ending also counts as the move landing.
    await expect.poll(async () => (await over.isVisible()) || (await moves.count()) > board.history().length).toBe(true)
  }
}

async function resignIfPlaying(page: Page) {
  const over = page.locator('#fim-titulo')
  if (await over.isVisible()) return
  await page.getByRole('button', { name: 'Abandonar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Abandonar' }).click()
  await expect(over).toHaveText('Você abandonou a partida')
}

test('plays the lowest level as White, resigns and shows both accuracies', async ({ page, axe }) => {
  await startAgainstLowestLevel(page)
  await playMoves(page, 40)
  await resignIfPlaying(page)
  const accuracy = page.getByRole('group', { name: 'Precisão' })
  await expect(accuracy).toBeVisible({ timeout: 240_000 })
  await expect(accuracy.getByText(/^\d+,\d$/)).toHaveCount(2)
  await axe()
})

test('a game left for a rematch before its review ends still reaches the history', async ({ page }) => {
  test.setTimeout(360_000)
  await startAgainstLowestLevel(page)
  await playMoves(page, 6)
  await resignIfPlaying(page)
  await page.getByRole('button', { name: 'Revanche' }).click()
  await expect(page.locator('#fim-titulo')).toBeHidden()

  await page.getByRole('link', { name: 'Histórico' }).filter({ visible: true }).click()
  const game = page.getByRole('link').filter({ hasText: 'vs Stockfish (Iniciante)' })
  await expect(game).toBeVisible({ timeout: 240_000 })
  await expect(game).toContainText('Jogada no Lance')
  await expect(game.getByText(/^\d+,\d$/)).toBeVisible()
  await expect(game).toContainText('sua precisão')
})
