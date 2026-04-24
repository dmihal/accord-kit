#!/usr/bin/env node
import { Command } from 'commander'
import path from 'node:path'
import { startAccordWatcher } from './watcher.js'

const program = new Command()
  .name('accord')
  .description('Sync a local folder with an AccordKit server')
  .argument('<dir>', 'directory to watch and sync')
  .requiredOption('-s, --server <url>', 'AccordKit server WebSocket URL', 'ws://localhost:1234')
  .option('-u, --user <name>', 'display name for this client', 'CLI')
  .option('--delete', 'permanently delete files on remote deletion (default: move to .accord-trash)')
  .option('--ignore <patterns...>', 'additional ignore patterns')

program.parse()

const opts = program.opts<{
  server: string
  user: string
  delete?: boolean
  ignore?: string[]
}>()
const dir = program.args[0]!

const root = path.resolve(dir)
console.log(`Syncing ${root} ↔ ${opts.server}`)

const watcher = await startAccordWatcher({
  root,
  serverUrl: opts.server,
  userName: opts.user,
  deletionBehavior: opts.delete ? 'delete' : 'trash',
  ignorePatterns: opts.ignore,
})

console.log('Ready. Press Ctrl+C to stop.')

process.on('SIGINT', async () => {
  await watcher.stop()
  process.exit(0)
})
