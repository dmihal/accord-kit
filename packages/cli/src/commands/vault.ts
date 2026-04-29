import { Command } from 'commander'
import { encodeJoinToken } from '@accord-kit/core'
import { ApiClient } from '../api.js'
import { loadCredentials, saveCredentials } from '../credentials.js'

async function getClient(serverOpt?: string): Promise<{ client: ApiClient; serverUrl: string }> {
  const creds = await loadCredentials(serverOpt)
  if (!creds) {
    console.error('Not logged in. Run: accord auth login <serverUrl>')
    process.exit(1)
  }
  return { client: new ApiClient(creds.serverUrl, creds.key), serverUrl: creds.serverUrl }
}

async function resolveVaultId(client: ApiClient, nameOrId: string): Promise<string> {
  // If it looks like an ID (no spaces, short hex), use it directly.
  // Otherwise look up by name via whoami vaults list.
  const me = await client.whoami()
  const match = me.vaults.find(v => v.name === nameOrId || v.id === nameOrId)
  if (!match) {
    console.error(`Vault "${nameOrId}" not found or you don't have access.`)
    process.exit(1)
  }
  return match.id
}

export function createVaultCommand(): Command {
  const vault = new Command('vault').description('Manage vaults')

  vault
    .command('create <name>')
    .description('Create a new vault (you get access automatically)')
    .option('-s, --server <url>', 'server URL for first-time setup or override')
    .option('-u, --user <name>', 'identity name when creating your first vault')
    .action(async (name: string, opts: { server?: string; user?: string }) => {
      const existing = await loadCredentials(opts.server)
      if (existing) {
        const client = new ApiClient(existing.serverUrl, existing.key)
        const result = await client.createVault(name)
        await saveCredentials({
          ...existing,
          activeVaultId: result.vaultId,
        })
        console.log(`Created vault "${result.name}" (${result.vaultId})`)
        return
      }

      if (!opts.server) {
        console.error('No server URL. Pass --server <url> to create your first vault.')
        process.exit(1)
      }
      if (!opts.user?.trim()) {
        console.error('No user name. Pass --user <name> to create your first vault.')
        process.exit(1)
      }

      const client = new ApiClient(opts.server)
      const result = await client.createVault(name, opts.user.trim())
      if (!result.key || !result.identityId || !result.userName) {
        throw new Error('Server did not return bootstrap credentials')
      }

      await saveCredentials({
        serverUrl: opts.server,
        identityId: result.identityId,
        name: result.userName,
        key: result.key,
        activeVaultId: result.vaultId,
      })
      console.log(`Created vault "${result.name}" (${result.vaultId})`)
      console.log(`Logged in as ${result.userName} (${result.identityId})`)
    })

  vault
    .command('list')
    .description('List vaults you have access to')
    .action(async () => {
      const { client } = await getClient()
      const info = await client.whoami()
      if (info.vaults.length === 0) {
        console.log('No vaults.')
      } else {
        for (const v of info.vaults) {
          console.log(`${v.name}  ${v.id}`)
        }
      }
    })

  vault
    .command('invite <vault>')
    .description('Generate a single-use invite code for a vault')
    .option('--ttl <days>', 'TTL in days', '7')
    .action(async (vaultArg: string, opts: { ttl: string }) => {
      const { client, serverUrl } = await getClient()
      const vaultId = await resolveVaultId(client, vaultArg)
      const ttlDays = parseInt(opts.ttl, 10) || 7
      const result = await client.createInvite(vaultId, ttlDays)
      const joinToken = encodeJoinToken({
        serverUrl,
        vaultId,
        inviteCode: result.code,
      })
      console.log(`Join token (expires ${result.expiresAt}):`)
      console.log()
      console.log(`  ${joinToken}`)
      console.log()
      console.log('Raw invite code:')
      console.log()
      console.log(`  ${result.code}`)
    })

  vault
    .command('invites <vault>')
    .description('List outstanding invites for a vault')
    .action(async (vaultArg: string) => {
      const { client } = await getClient()
      const vaultId = await resolveVaultId(client, vaultArg)
      const invites = await client.listInvites(vaultId)
      if (invites.length === 0) {
        console.log('No invites.')
      } else {
        for (const inv of invites) {
          const status = inv.redeemedBy ? `redeemed by ${inv.redeemedBy}` : `expires ${inv.expiresAt}`
          console.log(`${inv.code}  (${status})`)
        }
      }
    })

  vault
    .command('members <vault>')
    .description('List identities with access to a vault')
    .action(async (vaultArg: string) => {
      const { client } = await getClient()
      const vaultId = await resolveVaultId(client, vaultArg)
      const members = await client.listMembers(vaultId)
      if (members.length === 0) {
        console.log('No members.')
      } else {
        for (const m of members) {
          console.log(`${m.name}  ${m.identityId}  (granted ${m.grantedAt})`)
        }
      }
    })

  return vault
}
