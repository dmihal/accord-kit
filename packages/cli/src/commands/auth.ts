import { Command } from 'commander'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { ApiClient, ApiError } from '../api.js'
import { loadCredentials, saveCredentials, deleteCredentials } from '../credentials.js'

export function createAuthCommand(): Command {
  const auth = new Command('auth').description('Manage AccordKit credentials')

  auth
    .command('login <serverUrl>')
    .description('Set the active server and redeem an invite code if needed')
    .option('--name <name>', 'identity name for this device')
    .option('--invite <code>', 'invite code to redeem')
    .action(async (serverUrl: string, opts: { name?: string; invite?: string }) => {
      const existing = await loadCredentials(serverUrl)
      if (existing) {
        // Verify the key still works
        const client = new ApiClient(serverUrl, existing.key)
        try {
          const info = await client.whoami()
          await saveCredentials(existing)
          console.log(`Already logged in as ${info.name} (${info.identityId})`)
          console.log(`Vaults: ${info.vaults.map(v => v.name).join(', ') || '(none)'}`)
          return
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            console.log('Existing key is no longer valid — re-authenticating...')
          } else {
            throw err
          }
        }
      }

      const rl = readline.createInterface({ input, output })
      try {
        const code = opts.invite ?? (await rl.question('Invite code: ')).trim()

        if (code.startsWith('accord_sk_')) {
          // Direct key login for users who already have a saved key.
          const client = new ApiClient(serverUrl, code)
          const info = await client.whoami()
          await saveCredentials({
            serverUrl,
            identityId: info.identityId,
            name: info.name,
            key: code,
            activeVaultId: existing?.activeVaultId ?? info.vaults[0]?.id,
          })
          console.log(`Logged in as ${info.name} (${info.identityId})`)
          console.log(`Vaults: ${info.vaults.map(v => v.name).join(', ') || '(none)'}`)
        } else {
          const name = opts.name ?? (await rl.question('Identity name (e.g. "David\'s laptop"): ')).trim()

          const client = new ApiClient(serverUrl)
          const result = await client.redeem(code, name)

          await saveCredentials({
            serverUrl,
            identityId: result.identityId,
            name,
            key: result.key,
            activeVaultId: result.vaultId,
          })

          console.log(`Logged in. Identity ID: ${result.identityId}`)
          console.log(`Vault access granted: ${result.vaultId}`)
        }
      } finally {
        rl.close()
      }
    })

  auth
    .command('status')
    .description('Show current auth status')
    .option('-s, --server <url>', 'server URL (default: from credentials file)')
    .action(async (opts: { server?: string }) => {
      const creds = await loadCredentials(opts.server)
      if (!creds) {
        console.log('Not logged in. Run: accord auth login <serverUrl>')
        return
      }

      console.log(`Server:   ${creds.serverUrl}`)
      console.log(`Identity: ${creds.name} (${creds.identityId})`)

      const client = new ApiClient(creds.serverUrl, creds.key)
      try {
        const info = await client.whoami()
        console.log(`Vaults:   ${info.vaults.map(v => `${v.name} (${v.id})`).join(', ') || '(none)'}`)
      } catch {
        console.log('(could not reach server)')
      }
    })

  auth
    .command('logout')
    .description('Delete local credentials (does not revoke the key on the server)')
    .option('-s, --server <url>', 'server URL (default: from credentials file)')
    .option('-y, --yes', 'skip confirmation')
    .action(async (opts: { server?: string; yes?: boolean }) => {
      if (!opts.yes) {
        const rl = readline.createInterface({ input, output })
        try {
          const answer = await rl.question('Delete local credentials? [y/N] ')
          if (answer.trim().toLowerCase() !== 'y') {
            console.log('Aborted.')
            return
          }
        } finally {
          rl.close()
        }
      }
      await deleteCredentials(opts.server)
      console.log('Credentials deleted.')
    })

  return auth
}
