import { readFileSync, writeFileSync } from 'node:fs'
import subsetFont from 'subset-font'

// The symbols subset of Noto Sans Symbols 2 is 380 kB; the scoresheet only needs the twelve chess figurines.
const source = new URL('../node_modules/@fontsource/noto-sans-symbols-2/files/noto-sans-symbols-2-symbols-400-normal.woff2', import.meta.url)
const target = new URL('../src/assets/figurines.woff2', import.meta.url)
const figurines = String.fromCodePoint(...Array.from({ length: 12 }, (_, i) => 0x2654 + i))
const out = await subsetFont(readFileSync(source), figurines, { targetFormat: 'woff2' })
writeFileSync(target, out)
console.log(`figurines.woff2: ${out.length} bytes`)
