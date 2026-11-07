import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'

type Tuple = [string, string, string, string]
const book = (JSON.parse(readFileSync('src/openings/lines.json', 'utf8')).lines as Tuple[]).map(([, , uci]) => uci.split(' '))

/** A legal move after `moves` that no line of the book continues with. */
function offBook(moves: string[]): string {
  const board = new Chess()
  for (const u of moves) board.move(u)
  const prefix = moves.join(' ')
  const known = new Set(book.filter((l) => l.length > moves.length && l.slice(0, moves.length).join(' ') === prefix).map((l) => l[moves.length]))
  return board.moves({ verbose: true }).find((m) => !known.has(m.lan))!.lan
}

const coach = (page: Page) => page.locator('section[data-turn]')
const movesOf = async (page: Page) => ((await coach(page).getAttribute('data-moves')) ?? '').split(' ').filter(Boolean)

async function play(page: Page, uci: string) {
  await page.getByLabel('Digitar um lance').fill(uci)
  await page.getByLabel('Digitar um lance').press('Enter')
}

test('plays the Italian Game as White with the coach: book moves explained, a move out of the book explained and taken back', async ({ page, axe }) => {
  test.setTimeout(360_000)
  await page.goto('/#/treino/aberturas/Italian%20Game/brancas')
  await page.getByRole('link', { name: 'Jogar com o treinador' }).click()
  await expect(page).toHaveURL(/#\/treino\/treinador\/Italian%20Game\/brancas$/)
  await expect(page.getByRole('heading', { name: 'Com o treinador' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Treino' })).toHaveAttribute('aria-current', 'page')
  await expect(coach(page)).toHaveAttribute('data-turn', 'mine')
  await expect(coach(page)).toHaveAttribute('data-book', 'e2e4')
  await axe()

  await play(page, 'e2e4')
  await expect(coach(page)).toHaveAttribute('data-coach-move', 'e7e5')
  await expect(coach(page)).toHaveAttribute('data-turn', 'mine')
  const mine = page.getByRole('article', { name: 'Seu lance 1.e4' })
  await expect(mine).toContainText('É o único lance desta abertura aqui.')
  await expect(mine).toContainText('Ocupa o centro em e4')
  await expect(page.getByRole('article', { name: 'Lance do treinador 1…e5' })).toContainText('Teoria')
  await expect(mine.getByRole('status')).toHaveText(/^Avaliação [+-]?\d/, { timeout: 120_000 })

  const off = offBook(['e2e4', 'e7e5'])
  await play(page, off)
  await expect(coach(page)).toHaveAttribute('data-turn', 'departed')
  await expect(coach(page)).toHaveAttribute('data-departure', 'off-book')
  const departure = page.getByRole('article', { name: /^Seu lance 2\./ })
  await expect(departure).toContainText('não é teoria desta abertura.')
  await expect(departure).toContainText('Aqui a teoria joga 2.Nf3')
  await expect(departure.getByRole('status')).toHaveText(/^Avaliação .*, contra .* depois de 2\.Nf3: .* A resposta da engine é 2…/, { timeout: 120_000 })
  await axe()
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(coach(page)).toHaveAttribute('data-turn', 'mine')
  await expect(coach(page)).toHaveAttribute('data-departure', '')
  expect(await movesOf(page)).toEqual(['e2e4', 'e7e5'])

  // From here the coach picks its moves by chance, so the test follows whatever it played until theory ends or four more of mine.
  for (let mineLeft = 4; mineLeft > 0; mineLeft--) {
    await expect(coach(page)).toHaveAttribute('data-turn', /^(mine|done)$/)
    if ((await coach(page).getAttribute('data-turn')) === 'done') break
    const before = await movesOf(page)
    const [next] = (await coach(page).getAttribute('data-book'))!.split(' ')
    await play(page, next)
    await expect.poll(async () => (await movesOf(page)).length).toBeGreaterThanOrEqual(before.length + 1)
    expect((await movesOf(page)).slice(0, before.length + 1)).toEqual([...before, next])
  }
  await expect(coach(page)).toHaveAttribute('data-turn', /^(mine|done)$/)
  expect((await movesOf(page)).slice(0, 5)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'])
  await page.getByRole('list', { name: 'Lances da rodada' }).getByRole('button', { name: /^N ?c6$/ }).click()
  const nc6 = page.getByRole('article', { name: 'Lance do treinador 2…Nc6' })
  await expect(nc6).toContainText('É o único lance desta abertura aqui.')
  await expect(nc6).toContainText('Desenvolve o cavalo para c6, defende o peão de e5')
  await axe()
})
