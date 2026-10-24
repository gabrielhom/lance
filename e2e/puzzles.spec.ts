import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'

type Tuple = [string, string, string, number, string, string]
const bundled = new Map(
  (JSON.parse(readFileSync('src/puzzles/puzzles.json', 'utf8')).puzzles as Tuple[]).map(([id, fen, moves, rating, , gameUrl]) => [id, { fen, moves: moves.split(' '), rating, gameUrl }]),
)

const shown = async (page: Page) => {
  const id = await page.locator('[data-puzzle]').getAttribute('data-puzzle')
  const puzzle = bundled.get(id ?? '')
  if (!id || !puzzle) throw new Error(`puzzle ${id} is not in the bundled set`)
  return { id, ...puzzle }
}

async function play(page: Page, uci: string) {
  await expect(page.locator('[data-puzzle]')).toHaveAttribute('data-phase', 'player')
  await page.getByLabel('Digitar um lance').fill(uci)
  await page.getByLabel('Digitar um lance').press('Enter')
}

const rating = async (page: Page, played: number) => {
  const text = await page.getByText(new RegExp(`^Rating \\d+ · ${played} puzzles? feitos?$`)).textContent()
  return Number(/\d+/.exec(text ?? '')?.[0])
}

const attempts = (page: Page) =>
  page.evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open('lance')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const get = open.result.transaction('puzzles').objectStore('puzzles').getAll()
      get.onsuccess = () => {
        open.result.close()
        resolve(get.result.map((a) => [a.id, a.solved]))
      }
    }
  })`)

test('solves a puzzle and misses another: the rating goes up, then down, and survives a reload', async ({ page, axe }) => {
  await page.goto('/#/')
  await page.getByRole('link', { name: 'Resolver puzzles' }).click()
  await expect(page.getByRole('link', { name: 'Puzzles' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Rating 1500, para começar')).toBeVisible()
  await axe()

  const first = await shown(page)
  expect(Math.abs(first.rating - 1500)).toBeLessThanOrEqual(100)
  for (let i = 1; i < first.moves.length; i += 2) await play(page, first.moves[i])
  await expect(page.getByText('Resolvido')).toBeVisible()
  const up = await rating(page, 1)
  expect(up).toBeGreaterThan(1500)
  await expect(page.getByText(`Seu rating: ${up} +${up - 1500}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Próximo puzzle' })).toBeFocused()
  await axe()

  await page.getByRole('button', { name: 'Próximo puzzle' }).click()
  const second = await shown(page)
  const board = new Chess(second.fen)
  board.move(second.moves[0])
  const wrong = board.moves({ verbose: true }).find((m) => m.lan !== second.moves[1] && !m.san.endsWith('#'))!
  await play(page, wrong.lan)
  await expect(page.getByText('Não é esse')).toBeVisible()
  const down = await rating(page, 2)
  expect(down).toBeLessThan(up)
  await expect(page.getByText(`Seu rating: ${down} −${up - down}`)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver a partida no Lichess' })).toHaveAttribute('href', second.gameUrl)
  await page.getByRole('button', { name: 'Próximo lance' }).click()
  await expect(page.getByRole('button', { name: 'Próximo lance' })).toBeEnabled()
  await axe()

  expect(await attempts(page)).toEqual([[first.id, true], [second.id, false]].sort())
  await page.reload()
  await expect(page.getByText(`Rating ${down} · 2 puzzles feitos`)).toBeVisible()
  await page.goto('/#/')
  await expect(page.getByText(`rating ${down}`)).toBeVisible()
})
