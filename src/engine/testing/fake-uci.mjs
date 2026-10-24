#!/usr/bin/env node
// A UCI engine for bridge tests: appends every line it receives to $FAKE_UCI_LOG and answers just enough to be a bridge's engine.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

createInterface({ input: process.stdin }).on('line', (line) => {
  if (process.env.FAKE_UCI_LOG) appendFileSync(process.env.FAKE_UCI_LOG, `${line}\n`)
  if (line === 'uci') console.log('id name Fake UCI\nuciok')
  else if (line === 'isready') console.log('readyok')
  else if (line.startsWith('go ')) console.log('info depth 1 multipv 1 score cp 10 pv e2e4\nbestmove e2e4')
  else if (line === 'quit') process.exit(0)
})
