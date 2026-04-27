import { Command } from 'commander'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { ApiClient } from '../api.js'
import { loadCredentials, saveCredentials } from '../credentials.js'

export function createTokenCommand(): Command {
  const token = new Command('token').description('Manage keys and invite codes')

  token
    .command('redeem <code>')
    .description('Redeem an invite code to gain vault access (or create a new identity)')
    .option('-s, --server <url>', 'server URL (uses credential file if omitted)')
    .option('--name <name>', 'identity name when creating a new identity')
    .action(async (code: string, opts: { server?: string; name?: string }) => {
      const existing = await loadCredentials(opts.server)
      const serverUrl = opts.server ?? existing?.serverUrl

      if (!serverUrl) {
        console.error('No server URL. Pass --server <url> or log in first.')
        process.exit(1)
      }

      const rl = readline.createInterface({ input, output })
      let name = opts.name
      try {
        if (!existing && !name) {
          name = (await rl.question('Identity name (e.g. "David\'s laptop"): ')).trim()
        }
      } finally {
        rl.close()
      }

      const client = new ApiClient(serverUrl, existing?.key)
      const result = await client.redeem(code, name ?? existing?.name ?? 'unnamed')

      if (!existing) {
        await saveCredentials({
          serverUrl,
          identityId: result.identityId,
          name: name ?? 'unnamed',
          key: result.key,
        })
        console.log(`Identity created. Key saved to credentials file.`)
      } else {
        console.log(`Vault access added to existing identity (${existing.identityId}).`)
      }

      console.log(`Vault: ${result.vaultId}`)
    })

  token
    .command('revoke <identityId>')
    .description('Revoke an identity entirely (admin only)')
    .option('-s, --server <url>', 'server URL')
    .option('-y, --yes', 'skip confirmation')
    .action(async (identityId: string, opts: { server?: string; yes?: boolean }) => {
      const creds = await loadCredentials(opts.server)
      if (!creds) {
        console.error('Not logged in.')
        process.exit(1)
      }

      if (!opts.yes) {
        const rl = readline.createInterface({ input, output })
        try {
          const answer = await rl.question(`Revoke identity ${identityId}? This cannot be undone. [y/N] `)
          if (answer.trim().toLowerCase() !== 'y') {
            console.log('Aborted.')
            return
          }
        } finally {
          rl.close()
        }
      }

      const client = new ApiClient(creds.serverUrl, creds.key)
      await client.revokeIdentity(identityId)
      console.log('Identity revoked.')
    })

  return token
}
