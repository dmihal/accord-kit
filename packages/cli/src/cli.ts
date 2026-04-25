#!/usr/bin/env node
import { Command } from 'commander'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startAccordWatcher } from './watcher.js'

const program = new Command()
  .name('accord')
  .description('AccordKit — real-time document sync')

program
  .command('watch <dir>')
  .description('Watch a local directory and sync with an AccordKit server')
  .requiredOption('-s, --server <url>', 'AccordKit server WebSocket URL', 'ws://localhost:1234')
  .option('-u, --user <name>', 'display name for this client', 'CLI')
  .option('--delete', 'permanently delete files on remote deletion (default: move to .accord-trash)')
  .option('--ignore <patterns...>', 'additional ignore patterns')
  .action(async (dir: string, opts: { server: string; user: string; delete?: boolean; ignore?: string[] }) => {
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
  })

program
  .command('install-plugin <vault>')
  .description('Install the AccordKit Obsidian plugin into a vault')
  .action(async (vaultPath: string) => {
    const vault = path.resolve(vaultPath)

    try {
      await access(vault)
    } catch {
      console.error(`Error: path does not exist: ${vault}`)
      process.exit(1)
    }

    const obsidianDir = path.join(vault, '.obsidian')
    try {
      await access(obsidianDir)
    } catch {
      console.error(`Error: ${vault} does not look like an Obsidian vault (no .obsidian directory found)`)
      process.exit(1)
    }

    const pluginDir = path.join(obsidianDir, 'plugins', 'accord-kit')
    await mkdir(pluginDir, { recursive: true })

    const pluginDistDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin-dist')
    await copyFile(path.join(pluginDistDir, 'main.js'), path.join(pluginDir, 'main.js'))
    await copyFile(path.join(pluginDistDir, 'manifest.json'), path.join(pluginDir, 'manifest.json'))

    const communityPluginsPath = path.join(obsidianDir, 'community-plugins.json')
    let enabled: string[] = []
    try {
      enabled = JSON.parse(await readFile(communityPluginsPath, 'utf8')) as string[]
    } catch {
      // file absent on fresh vaults — start empty
    }
    if (!enabled.includes('accord-kit')) {
      enabled.push('accord-kit')
      await writeFile(communityPluginsPath, JSON.stringify(enabled, null, 2) + '\n', 'utf8')
    }

    console.log(`Plugin installed at ${pluginDir}`)
    console.log('Restart Obsidian (or reload plugins) to activate AccordKit.')
  })

await program.parseAsync()
