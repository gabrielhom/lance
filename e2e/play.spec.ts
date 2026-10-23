import { Chess } from 'chess.js'
import { expect, test } from './test.ts'

const MAX_MOVES = 40

test('plays the lowest level as White, resigns and shows both accuracies', async ({ page, axe }) => {
  await page.goto('/')
  await page.getByText('Iniciante', { exact: true }).click()
  await page.getByText('Brancas', { exact: true }).click()
  await page.getByText('Sem relógio', { exact: true }).click()
  await page.getByRole('button', { name: 'Jogar', exact: true }).click()

  const over = page.locator('#fim-titulo')
  const myTurn = page.getByText('Sua vez', { exact: true })
  const moves = page.getByRole('list', { name: 'Lances da partida' })
  for (let n = 0; n < MAX_MOVES; n++) {
    await expect(myTurn.or(over)).toBeVisible({ timeout: 60_000 })
    if (await over.isVisible()) break
    const board = new Chess()
    for (const san of await moves.locator('li > span:not(:first-child)').allInnerTexts()) if (san.trim()) board.move(san.trim())
    const legal = board.moves()
    await page.getByLabel('Digitar um lance').fill(legal[n % legal.length])
    await page.getByLabel('Digitar um lance').press('Enter')
    await expect.poll(() => moves.locator('li > span:not(:first-child)').filter({ hasText: /\S/ }).count()).toBeGreaterThan(board.history().length)
  }

  if (!(await over.isVisible())) {
    await page.getByRole('button', { name: 'Abandonar' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Abandonar' }).click()
    await expect(over).toHaveText('Você abandonou a partida')
  }
  const accuracy = page.getByRole('group', { name: 'Precisão' })
  await expect(accuracy).toBeVisible({ timeout: 240_000 })
  await expect(accuracy.getByText(/^\d+(,\d)?%$/)).toHaveCount(2)
  await axe()
})
