import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// The multi-threaded Stockfish build needs SharedArrayBuffer, which only exists on cross-origin isolated pages.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// scripts/copy-engine.mjs puts the engine under public/engine/<this version>/.
const stockfish = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('stockfish/package.json'), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.STOCKFISH_VERSION': JSON.stringify(stockfish.version) },
  // public/sw.js reads this list to keep every file of the current build offline.
  build: { manifest: 'build-manifest.json' },
  server: { headers: isolation },
  preview: { headers: isolation },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
