import { createAccordServer, defaultServerConfig, KeyStore, runMigrations, generateKey } from '@accord-kit/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

export interface TestServer {
  wsUrl: string
  httpUrl: string
  createVault: (vaultId: string) => Promise<void>
  stop: () => Promise<void>
}

export interface StartTestServerOptions {
  sqlitePath?: string
  authMode?: 'open' | 'key'
  vaults?: string[]
  auth?:
    | { mode: 'open' }
    | {
      mode: 'jwt'
      issuer?: string
      audience?: string
      publicKeyPath: string
      algorithm?: 'ES256' | 'RS256'
      kid?: string
    }
}

export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  const auth = options.authMode === 'key'
    ? { mode: 'key' as const }
    : options.auth ?? { mode: 'open' as const }
  const server = createAccordServer({
    ...defaultServerConfig(),
    port: 0,
    auth: auth.mode === 'jwt'
      ? {
        mode: 'jwt',
        jwt: {
          issuer: auth.issuer,
          audience: auth.audience,
          publicKeys: [{
            kid: auth.kid ?? 'test',
            algorithm: auth.algorithm ?? 'ES256',
            publicKeyPath: auth.publicKeyPath,
          }],
        },
      }
      : {
        mode: auth.mode === 'key' ? 'key' : 'open',
        jwt: {
          publicKeys: [],
        },
      },
    storage: {
      driver: 'sqlite',
      sqlite: {
        path: options.sqlitePath ?? ':memory:',
      },
      postgres: {
        url: '',
        poolSize: 10,
      },
    },
    quiet: true,
  })

  await server.listen()
  for (const vaultId of options.vaults ?? ['default']) {
    await server.accord.storage.createVault(vaultId)
  }

  return {
    wsUrl: server.webSocketURL,
    httpUrl: server.httpURL,
    createVault: (vaultId: string) => server.accord.storage.createVault(vaultId),
    stop: async () => {
      await server.destroy()
    },
  }
}

export interface AuthTestServer extends TestServer {
  store: KeyStore
  adminKey: string
  adminId: string
  defaultVaultId: string
  tmpDir: string
}

export async function startAuthTestServer(): Promise<AuthTestServer> {
  // Use a temp file so we can seed the DB before the server opens it.
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'accord-auth-test-'))
  const dbPath = path.join(tmpDir, 'test.db')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const require = createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BetterSqlite3 = require('better-sqlite3') as new (p: string) => any
  const db = new BetterSqlite3(dbPath)
  runMigrations(db)

  const store = new KeyStore(db)

  // Bootstrap: default vault + admin identity
  const adminKey = generateKey()
  const defaultVault = store.createVault('default', null)
  const adminIdentity = store.createIdentity('admin', adminKey, true)
  db.prepare('UPDATE vaults SET created_by = ? WHERE id = ?').run(adminIdentity.id, defaultVault.id)
  store.grantVaultAccess(adminIdentity.id, defaultVault.id, adminIdentity.id)

  db.close()

  // Now start the server — it will reopen the same DB file.
  const server = createAccordServer({
    ...defaultServerConfig(),
    port: 0,
    auth: {
      mode: 'key',
      jwt: {
        publicKeys: [],
      },
    },
    storage: {
      driver: 'sqlite',
      sqlite: { path: dbPath },
      postgres: {
        url: '',
        poolSize: 10,
      },
    },
    quiet: true,
  })

  await server.listen()

  // Re-open the DB for test helpers to inspect/manipulate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testDb = new BetterSqlite3(dbPath)
  runMigrations(testDb)
  const testStore = new KeyStore(testDb)

  return {
    wsUrl: server.webSocketURL,
    httpUrl: server.httpURL,
    store: testStore,
    adminKey,
    adminId: adminIdentity.id,
    defaultVaultId: defaultVault.id,
    tmpDir,
    stop: async () => {
      testDb.close()
      await server.destroy()
      await rm(tmpDir, { recursive: true, force: true })
    },
  }
}
