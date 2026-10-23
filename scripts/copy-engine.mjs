import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const bin = join(dirname(require.resolve('stockfish/package.json')), 'bin')
const out = 'public/engine'
mkdirSync(out, { recursive: true })
for (const flavor of ['stockfish-19-lite', 'stockfish-19']) {
  for (const ext of ['.js', '.wasm']) copyFileSync(join(bin, flavor + ext), join(out, flavor + ext))
}
