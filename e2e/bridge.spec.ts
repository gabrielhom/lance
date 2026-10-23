import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from './test.ts'

const native = 'engines/stockfish-19'
let bridge: ChildProcess

test.skip(!existsSync(native), 'native Stockfish binary not downloaded')

test.beforeAll(async () => {
  bridge = spawn('node', ['bridge/server.mjs', '--engine', `sf19=${native}`, '--port', '7799'], { stdio: 'pipe' })
  await new Promise<void>((resolve, reject) => {
    bridge.stdout?.on('data', (d: Buffer) => d.toString().includes('7799') && resolve())
    bridge.on('exit', (code) => reject(new Error(`bridge exited ${code}`)))
  })
})
test.afterAll(() => bridge?.kill())

test('reviews a game with a native engine through the local bridge', async ({ page }) => {
  await page.goto('/#/config')
  await page.getByLabel(/Engine local/).check()
  await page.getByLabel('URL do bridge').fill('http://127.0.0.1:7799')
  await page.getByRole('button', { name: 'Testar' }).click()
  await page.getByLabel('Stockfish 19', { exact: false }).last().check()

  await page.goto('/#/revisar')
  await page.getByLabel('PGN', { exact: true }).fill(readFileSync('e2e/fixtures/opera.pgn', 'utf8'))
  await page.getByRole('button', { name: 'Revisar partida' }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByLabel('Resumo')).toContainText('Brilhante')
})
