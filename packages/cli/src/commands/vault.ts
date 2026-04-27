import { Command } from 'commander'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { ApiClient } from '../api.js'
import { loadCredentials } from '../credentials.js'

async function getClient(serverOpt?: string): Promise<{ client: ApiClient; vaultId?: string }> {
  const creds = await loadCredentials(serverOpt)
  if (!creds) {
    console.error('Not logged in. Run: accord auth login <serverUrl>')
    process.exit(1)
  }
  return { client: new ApiClient(creds.serverUrl, creds.key) }
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
    .action(async (name: string) => {
      const { client } = await getClient()
      const result = await client.createVault(name)
      console.log(`Created vault "${result.name}" (${result.vaultId})`)
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
      const { client } = await getClient()
      const vaultId = await resolveVaultId(client, vaultArg)
      const ttlDays = parseInt(opts.ttl, 10) || 7
      const result = await client.createInvite(vaultId, ttlDays)
      console.log(`Invite code (expires ${result.expiresAt}):`)
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

  vault
    .command('revoke <vault> <identityId>')
    .description("Revoke an identity's access to a vault")
    .option('-y, --yes', 'skip confirmation')
    .action(async (vaultArg: string, identityId: string, opts: { yes?: boolean }) => {
      const { client } = await getClient()
      const vaultId = await resolveVaultId(client, vaultArg)

      if (!opts.yes) {
        const rl = readline.createInterface({ input, output })
        try {
          const answer = await rl.question(`Revoke ${identityId} from vault ${vaultArg}? [y/N] `)
          if (answer.trim().toLowerCase() !== 'y') {
            console.log('Aborted.')
            return
          }
        } finally {
          rl.close()
        }
      }

      await client.revokeMember(vaultId, identityId)
      console.log('Access revoked.')
    })

  return vault
}
