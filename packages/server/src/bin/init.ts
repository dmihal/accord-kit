import { createRequire } from 'node:module'
import { KeyStore, runMigrations, generateKey } from '../auth/key-store.js'
import { loadServerConfig } from '../config.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any

export async function runInit(options: { name?: string; config?: string }): Promise<void> {
  const config = await loadServerConfig({ configPath: options.config })
  const dbPath = config.persistence.path

  if (dbPath === ':memory:') {
    console.error('Error: cannot init with in-memory database')
    process.exit(1)
  }

  const require = createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BetterSqlite3 = require('better-sqlite3') as new (path: string) => AnyDb
  const db: AnyDb = new BetterSqlite3(dbPath)

  runMigrations(db)
  const store = new KeyStore(db)

  if (store.isInitialized()) {
    const existingDefault = store.getVaultByName('default')
    console.log('Already initialized.')
    if (existingDefault) console.log(`Default vault ID: ${existingDefault.id}`)
    console.log('To issue access, run: accord vault invite default')
    db.close()
    return
  }

  const adminName = options.name ?? 'admin'
  const key = generateKey()

  const defaultVault = store.createVault('default', null)
  const identity = store.createIdentity(adminName, key, true)

  // Back-fill created_by now that the identity row exists.
  db.prepare('UPDATE vaults SET created_by = ? WHERE id = ?').run(identity.id, defaultVault.id)

  store.grantVaultAccess(identity.id, defaultVault.id, identity.id)

  console.log('Initialized AccordKit.')
  console.log(`Admin identity: ${adminName} (${identity.id})`)
  console.log(`Default vault: ${defaultVault.id}`)
  console.log()
  console.log('Key (save this — it will not be shown again):')
  console.log()
  console.log(`  ${key}`)
  console.log()
  console.log('Add this to your credentials file and start the server with auth.mode: key')

  db.close()
}
