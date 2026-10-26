import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'

type Tuple = [string, string, string, string]
const lines = (JSON.parse(readFileSync('src/openings/lines.json', 'utf8')).lines as Tuple[]).map(([, name, uci]) => ({ name, moves: uci.split(' ') }))

/** The book's moves after the first `ply` moves of `line`, in the Caro-Kann only when `family` says so. */
function bookMovesAt(line: string[], ply: number, family: boolean): string[] {
  const prefix = line.slice(0, ply).join(' ')
  return lines
    .filter((l) => (!family || l.name.startsWith('Caro-Kann Defense')) && l.moves.length > ply && l.moves.slice(0, ply).join(' ') === prefix)
    .map((l) => l.moves[ply])
}

/** A legal move at `ply` that no line of the book continues with. */
function offBook(line: string[], ply: number): string {
  const board = new Chess()
  for (const u of line.slice(0, ply)) board.move({ from: u.slice(0, 2), to: u.slice(2, 4) })
  const known = new Set(bookMovesAt(line, ply, false))
  return board.moves({ verbose: true }).find((m) => !known.has(m.lan))!.lan
}

type Row = { id: string; schedule: { box: number; due: number; last: { at: number; correct: boolean } | null } }

const rows = (page: Page): Promise<Row[]> =>
  page.evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open('lance')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const get = open.result.transaction('openings').objectStore('openings').getAll()
      get.onsuccess = () => {
        open.result.close()
        resolve(get.result)
      }
    }
  })`)

const day = (page: Page, offset: number) =>
  page.evaluate((d) => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    t.setDate(t.getDate() + d)
    return t.getTime()
  }, offset)

/** Picks an option of a segmented choice by its label, as a pointer does: the radio itself is visually hidden. */
async function pick(page: Page, name: string | RegExp) {
  await page.locator('label', { has: page.getByRole('radio', { name }) }).click()
  await expect(page.getByRole('radio', { name })).toBeChecked()
}

async function play(page: Page, uci: string) {
  await expect(page.locator('section[data-line]')).toHaveAttribute('data-turn', 'mine')
  await page.getByLabel('Digitar um lance').fill(uci)
  await page.getByLabel('Digitar um lance').press('Enter')
}

test('studies the Caro-Kann as Black: a new variation with arrows, then from memory, where theory and a miss are told apart', async ({ page, axe }) => {
  await page.goto('/#/treino')
  await page.getByRole('link', { name: 'Aberturas' }).click()
  await expect(page.getByRole('heading', { name: 'Aberturas', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Treino' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('list', { name: 'Mais jogadas' }).getByRole('listitem').first()).toContainText('Defesa Siciliana')
  await pick(page, 'Pretas')
  await page.getByLabel('Buscar').fill('caro')
  const row = page.getByRole('list', { name: 'Resultado da busca' }).getByRole('listitem')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Defesa Caro-Kann')
  await expect(row).toContainText('Caro-Kann Defense')
  await expect(row).toContainText('1.e4 c6')
  await expect(row).toContainText(/\d+ variações$/)
  await axe()

  await row.getByRole('link', { name: 'Defesa Caro-Kann' }).click()
  await expect(page).toHaveURL(/#\/treino\/aberturas\/Caro-Kann%20Defense\/pretas$/)
  await expect(page.getByRole('heading', { name: 'Caro-Kann Defense' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText(/^B10–B19 · 0 de \d+ variações aprendidas$/)
  await expect(page.getByRole('link', { name: 'Pretas' })).toHaveAttribute('aria-current', 'page')
  await axe()

  // A session starts with new lines, each shown with an arrow on every one of my moves; typing the arrow's move plays it.
  await page.getByRole('button', { name: 'Estudar' }).click()
  const drill = page.locator('section[data-line]')
  await expect(page.getByRole('region', { name: 'Variação nova·1 de 5' })).toBeVisible()
  await expect(drill).toHaveAttribute('data-turn', 'mine')
  const line = (await drill.getAttribute('data-line'))!.split(' ')
  expect(line.slice(0, 2)).toEqual(['e2e4', 'c7c6'])
  for (let ply = 1; ply < line.length; ply += 2) {
    await expect(drill).toHaveAttribute('data-hint', line[ply])
    await play(page, line[ply])
  }
  await expect(page.getByText('Aprendida')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Próxima' })).toBeFocused()
  await axe()
  const learned = await rows(page)
  expect(learned.map((r) => r.id)).toEqual([`b ${line.join(' ')}`])
  expect(learned[0].schedule).toMatchObject({ box: 0, due: await day(page, 1), last: { correct: true } })

  // The learned line waits for tomorrow; drilling it now is practice from memory, with no arrow until a miss.
  await page.goto('/#/treino/aberturas')
  await page.goto('/#/treino/aberturas/Caro-Kann%20Defense/pretas')
  await expect(page.getByRole('status')).toHaveText(/ 1 de \d+ variações aprendidas$/)
  const item = page.locator(`li[data-line="${line.join(' ')}"]`)
  await page.locator('details').filter({ has: item }).locator('summary').click()
  await expect(item).toContainText('Volta amanhã')
  await item.getByRole('button', { name: 'Treinar' }).click()
  await expect(page.getByRole('region', { name: 'Treino extra·1 de 1' })).toBeVisible()
  let tested = false
  for (let ply = 1; ply < line.length; ply += 2) {
    await expect(drill).toHaveAttribute('data-turn', 'mine')
    await expect(drill).toHaveAttribute('data-hint', '')
    const sibling = bookMovesAt(line, ply, true).find((m) => m !== line[ply])
    if (sibling && !tested) {
      await play(page, sibling)
      await expect(page.getByText(/é teoria, Caro-Kann Defense: .*tente outro lance\.$/)).toBeVisible()
      await expect(drill).toHaveAttribute('data-hint', '')
      await play(page, offBook(line, ply))
      await expect(page.getByText(/^Não é esse: .* O lance da variação é .* Jogue-o para continuar\.$/)).toBeVisible()
      await expect(drill).toHaveAttribute('data-hint', line[ply])
      tested = true
    }
    await play(page, line[ply])
  }
  expect(tested).toBe(true)
  await expect(page.getByText('Com erro')).toBeVisible()
  await expect(page.getByText('Ela volta mais uma vez no fim desta sessão. A agenda não muda.')).toBeVisible()
  expect((await rows(page)).map((r) => r.schedule)).toEqual(learned.map((r) => r.schedule))
  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(page.getByRole('region', { name: 'Outra tentativa·2 de 2' })).toBeVisible()

  // The catalog remembers Black and shows the Caro-Kann among my openings, with what is learned.
  await page.goto('/#/treino/aberturas')
  await expect(page.getByRole('radio', { name: 'Pretas' })).toBeChecked()
  const mine = page.getByRole('list', { name: 'Suas aberturas' }).getByRole('listitem')
  await expect(mine).toHaveCount(1)
  await expect(mine).toContainText(/1 de \d+ aprendidas$/)
})

test("gathers the King's Pawn Game systems in one family, each a group, and a link can open one of them", async ({ page }) => {
  await page.goto('/#/treino/aberturas')
  await page.getByLabel('Buscar').fill('peao do rei')
  const row = page.getByRole('list', { name: 'Resultado da busca' }).getByRole('listitem')
  await expect(row).toHaveCount(1)
  await row.getByRole('link', { name: 'Abertura do Peão do Rei' }).click()
  await expect(page).toHaveURL(/#\/treino\/aberturas\/King's%20Pawn%20Game\/brancas$/)
  await expect(page.getByRole('heading', { name: "King's Pawn Game" })).toBeVisible()
  const group = (name: string) => page.locator('details').filter({ has: page.locator('summary', { hasText: name }) })
  const bavarian = group('Bavarian Gambit')
  await expect(bavarian.locator('summary')).toContainText('Bavarian Gambit · 1 variação')
  await expect(bavarian).not.toHaveAttribute('open')
  await expect(group('Wayward Queen Attack').locator('summary')).toContainText('Wayward Queen Attack · 2 variações')

  await page.goto("/#/treino/aberturas/King's%20Pawn%20Game/brancas/Bavarian%20Gambit")
  await expect(bavarian).toHaveAttribute('open')
  await expect(page.getByRole('list', { name: 'Bavarian Gambit' }).getByRole('listitem')).toHaveCount(1)
})
