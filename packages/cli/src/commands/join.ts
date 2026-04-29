import { Command } from 'commander'
import { decodeJoinToken } from '@accord-kit/core'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { ApiClient } from '../api.js'
import { loadCredentials, saveCredentials } from '../credentials.js'
import { installObsidianPlugin } from '../obsidian.js'

export function createJoinCommand(): Command {
  return new Command('join')
    .description('Redeem a bundled invite token and optionally scaffold an Obsidian vault')
    .argument('<token>', 'accord:// join token')
    .argument('[path]', 'optional Obsidian vault path')
    .action(async (token: string, targetPath?: string) => {
      const decoded = decodeJoinToken(token)
      const existing = await loadCredentials(decoded.serverUrl)
      let name = existing?.name

      if (!existing) {
        const rl = readline.createInterface({ input, output })
        try {
          name = (await rl.question('Identity name (e.g. "David\'s laptop"): ')).trim()
        } finally {
          rl.close()
        }
        if (!name) {
          console.error('Identity name is required.')
          process.exit(1)
        }
      }

      const client = new ApiClient(decoded.serverUrl, existing?.key)
      const result = await client.redeem(decoded.inviteCode, name ?? existing?.name ?? 'unnamed')
      const creds = existing
        ? {
          ...existing,
          activeVaultId: result.vaultId,
        }
        : {
          serverUrl: decoded.serverUrl,
          identityId: result.identityId,
          name: name ?? 'unnamed',
          key: result.key,
          activeVaultId: result.vaultId,
        }
      await saveCredentials(creds)

      if (targetPath) {
        const install = await installObsidianPlugin(targetPath, {
          scaffoldIfMissing: true,
          settings: {
            serverUrl: decoded.serverUrl,
            apiKey: creds.key,
            vaultId: result.vaultId,
            userName: creds.name,
          },
        })
        console.log(`Plugin installed at ${install.pluginDir}`)
        if (install.scaffoldedVault) {
          console.log('Scaffolded a new Obsidian vault.')
        }
        console.log('Open the folder in Obsidian to start syncing.')
        return
      }

      console.log(`Joined vault ${result.vaultId}.`)
      console.log(`Run: accord watch <dir> --vault ${result.vaultId}`)
    })
}
