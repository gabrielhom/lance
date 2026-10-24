import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'

const opera = readFileSync('e2e/fixtures/opera.pgn', 'utf8')

type Row = {
  id: string
  gameId: string
  index: number
  input: { root: string; tail: string[] }
  played: { san: string; uci: string }
  best: { pv: string[] }
  alternative: { pv: string[] } | null
  schedule: { box: number; due: number; last: { at: number; correct: boolean } | null }
}

/** The training store as the app saved it, in the order the session asks: one game, so by move. */
const rows = async (page: Page): Promise<Row[]> =>
  ((await page.evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open('lance')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const get = open.result.transaction('training').objectStore('training').getAll()
      get.onsuccess = () => {
        open.result.close()
        resolve(get.result)
      }
    }
  })`)) as Row[]).sort((a, b) => a.index - b.index)

async function answer(page: Page, move: string) {
  await page.getByLabel('Digitar um lance').fill(move)
  await page.getByLabel('Digitar um lance').press('Enter')
  await expect(page.getByRole('button', { name: 'Próxima' })).toBeFocused({ timeout: 120_000 })
}

test('trains the blunders of a reviewed game: a wrong and a right answer move the schedule', async ({ page, axe }) => {
  test.setTimeout(360_000)
  await page.goto('/#/config')
  await page.getByLabel('Lichess').fill('Duke Karl / Count Isouard')
  await page.getByLabel('Lichess').blur()
  await page.goto('/#/revisar')
  await page.getByLabel('PGN', { exact: true }).fill(opera)
  await page.getByRole('button', { name: 'Revisar partida' }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 240_000 })
  await expect(page.getByRole('link', { name: 'Treinar os erros desta partida' })).toBeVisible()

  const items = await rows(page)
  expect(items.map((i) => i.played.san)).toEqual(['b5', 'cxb5'])
  expect(items.map((i) => i.schedule)).toEqual(items.map((i) => ({ box: 0, due: i.schedule.due, last: null })))

  await page.goto('/#/')
  await page.getByRole('link', { name: 'Treinar 2 posições dos seus erros' }).click()
  await expect(page.getByText('2 posições para hoje', { exact: true })).toBeVisible()
  await axe()

  const [wrong, right] = items
  await answer(page, wrong.played.uci)
  await expect(page.getByText('Não é esse')).toBeVisible()
  await expect(page.getByText(/^Na partida você jogou/)).toBeVisible()
  await expect(page.getByText('1 posição para hoje · 1 feita hoje, 0 certas')).toBeVisible()
  await axe()
  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(page.getByLabel('Digitar um lance')).toBeFocused()

  await answer(page, right.best.pv[0])
  await expect(page.getByText('É o lance da engine.')).toBeVisible()
  await expect(page.getByText('Nada para hoje · 2 feitas hoje, 1 certa')).toBeVisible()

  const saved = await rows(page)
  const day = (offset: number) => page.evaluate((d) => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    t.setDate(t.getDate() + d)
    return t.getTime()
  }, offset)
  expect(saved.find((i) => i.id === wrong.id)?.schedule).toMatchObject({ box: 0, due: await day(1), last: { correct: false } })
  expect(saved.find((i) => i.id === right.id)?.schedule).toMatchObject({ box: 1, due: await day(3), last: { correct: true } })

  // The miss comes back once at the end of the session, and getting it right now leaves its schedule alone.
  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(page.getByText('Outra tentativa. Esta posição já volta amanhã, acertando ou não.')).toBeVisible()
  await expect(page.locator('#treino-onde')).toHaveText(/3 de 3$/)
  await answer(page, wrong.best.pv[0])
  await expect(page.getByText('É o lance da engine.')).toBeVisible()
  expect((await rows(page)).map((i) => i.schedule)).toEqual(saved.map((i) => i.schedule))

  await page.getByRole('link', { name: 'Ver o lance na revisão' }).click()
  await expect(page).toHaveURL(new RegExp(`#/revisao/${encodeURIComponent(wrong.gameId)}/${wrong.index + 1}$`))
  await expect(page.getByRole('button', { name: new RegExp(`^Pretas: ${wrong.played.san.replace(/[+]/g, '\\+')},`) })).toHaveAttribute('aria-current', 'true')

  // Nothing is due now, so practice goes to the engine for a move neither stored line settles and leaves the schedule alone.
  await page.goto('/#/treino')
  await expect(page.getByText('Pronto por hoje.')).toBeVisible()
  await page.getByRole('button', { name: 'Treinar mesmo assim' }).click()
  await expect(page.getByText('Treino extra: esta posição só volta para a agenda no dia marcado.')).toBeVisible()
  const board = new Chess(wrong.input.root)
  for (const u of wrong.input.tail) board.move(u)
  const settled = [wrong.best.pv[0], wrong.played.uci, wrong.alternative?.pv[0]]
  const move = board.moves({ verbose: true }).find((m) => !settled.includes(m.lan))!
  await answer(page, move.lan)
  await expect(page.getByText(/^(Certo|Não é esse)$/)).toBeVisible()
  expect((await rows(page)).map((i) => i.schedule)).toEqual(saved.map((i) => i.schedule))

  await page.goto('/#/')
  await page.reload()
  await expect(page.getByRole('link', { name: /dos seus erros/ })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Nova partida' })).toBeVisible()
})

test('an old tab facing a newer database asks for a reload instead of a blank page', async ({ page }) => {
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'Nova partida' })).toBeVisible()
  // The open tab gives way to the newer version and reloads, then can't open the database at all.
  const reloaded = page.waitForEvent('load')
  await page.evaluate("new Promise((resolve) => { const r = indexedDB.open('lance', 99); r.onsuccess = () => resolve(r.result.close()) })")
  await reloaded
  await expect(page.getByText('Esta aba tem uma versão antiga do Lance. Recarregue a página para abrir a nova.')).toBeVisible()
  const again = page.waitForEvent('load')
  await page.getByRole('button', { name: 'Recarregar' }).click()
  await again
  await expect(page.getByRole('button', { name: 'Recarregar' })).toBeVisible()
})
