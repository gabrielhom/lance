import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

// The version in the path lets the files be cached forever. vite.config.ts reads the same package.json for the URL.
const require = createRequire(import.meta.url)
const pkg = require.resolve('stockfish/package.json')
const { version } = JSON.parse(readFileSync(pkg, 'utf8'))
const bin = join(dirname(pkg), 'bin')
const out = join('public/engine', version)
rmSync('public/engine', { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const flavor of ['stockfish-19-lite-single', 'stockfish-19']) {
  for (const ext of ['.js', '.wasm']) copyFileSync(join(bin, flavor + ext), join(out, flavor + ext))
}
