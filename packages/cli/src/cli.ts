#!/usr/bin/env node
import { Command } from 'commander'
import path from 'node:path'
import { startAccordWatcher } from './watcher.js'
import { loadCredentials } from './credentials.js'
import { installObsidianPlugin } from './obsidian.js'
import { resolveOnChangePrefix } from './on-change.js'
import { createAuthCommand } from './commands/auth.js'
import { createJoinCommand } from './commands/join.js'
import { createVaultCommand } from './commands/vault.js'
import { createTokenCommand } from './commands/token.js'

const program = new Command()
  .name('accord')
  .description('AccordKit — real-time document sync')

program
  .command('watch <dir>')
  .description('Watch a local directory and sync with an AccordKit server')
  .option('-s, --server <url>', 'AccordKit server WebSocket URL')
  .option('-u, --user <name>', 'display name for this client')
  .option('--vault <vault>', 'vault ID to sync with')
  .option('--token <key>', 'API key (overrides credentials file)')
  .option('--delete', 'permanently delete files on remote deletion (default: move to .accord-trash)')
  .option('--ignore <patterns...>', 'additional ignore patterns')
  .option('--on-change <command>', 'shell command to run when remote document changes arrive')
  .option('--on-change-prefix <text>', 'text prepended to the on-change prompt piped to stdin')
  .option('--on-change-prefix-file <path>', 'read the on-change prefix text from a file')
  .action(async (dir: string, opts: {
    server?: string
    user?: string
    vault?: string
    token?: string
    delete?: boolean
    ignore?: string[]
    onChange?: string
    onChangePrefix?: string
    onChangePrefixFile?: string
  }) => {
    // Resolve credentials: --token flag takes priority, then credentials file.
    let serverUrl = opts.server
    let userName = opts.user
    let key = opts.token

    if (!key) {
      const creds = await loadCredentials(serverUrl)
      if (creds) {
        serverUrl ??= creds.serverUrl
        userName ??= creds.name
        key = creds.key
        opts.vault ??= creds.activeVaultId
      }
    }

    serverUrl ??= 'ws://localhost:1234'
    userName ??= 'CLI'
    if (!opts.vault) {
      console.error('No vault selected. Pass --vault <vaultId> or join/select a vault first.')
      process.exit(1)
    }
    const onChangePrefix = await resolveOnChangePrefix({
      onChangePrefix: opts.onChangePrefix,
      onChangePrefixFile: opts.onChangePrefixFile,
    })

    const root = path.resolve(dir)
    console.log(`Syncing ${root} ↔ ${serverUrl} (vault: ${opts.vault})`)

    const watcher = await startAccordWatcher({
      root,
      serverUrl,
      userName,
      vaultId: opts.vault,
      token: key,
      deletionBehavior: opts.delete ? 'delete' : 'trash',
      ignorePatterns: opts.ignore,
      onChangeCommand: opts.onChange,
      onChangePrefix,
    })

    console.log('Ready. Press Ctrl+C to stop.')

    process.on('SIGINT', async () => {
      await watcher.stop()
      process.exit(0)
    })
  })

program
  .command('install-plugin <vault>')
  .description('Install the AccordKit Obsidian plugin into a vault')
  .action(async (vaultPath: string) => {
    try {
      const install = await installObsidianPlugin(path.resolve(vaultPath))
      console.log(`Plugin installed at ${install.pluginDir}`)
      console.log('Restart Obsidian (or reload plugins) to activate AccordKit.')
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

program.addCommand(createAuthCommand())
program.addCommand(createJoinCommand())
program.addCommand(createVaultCommand())
program.addCommand(createTokenCommand())

try {
  await program.parseAsync()
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
