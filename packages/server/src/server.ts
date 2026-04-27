import { SQLite } from '@hocuspocus/extension-sqlite'
import { Server, type Extension, type Hocuspocus } from '@hocuspocus/server'
import type { AccordServerConfig } from './config.js'
import { runMigrations, KeyStore } from './auth/key-store.js'
import { createKeyVerifier } from './auth/key.js'
import { createDocumentsRouteExtension, createIdentityRouteExtension } from './routes.js'

export function createAccordServer(config: AccordServerConfig): Server {
  const sqlite = new SQLite({
    database: config.persistence.path,
  })

  const extensions: Extension[] = [
    createDocumentsRouteExtension({
      documentIds: new Set(),
      getPersistedDocumentIds: () => listPersistedDocumentIds(sqlite),
    }),
    sqlite,
  ]

  if (config.verbose) {
    extensions.unshift(createVerboseLogger())
  }

  const server = new Server({
    address: config.address,
    port: config.port,
    quiet: config.quiet,
    debounce: 100,
    maxDebounce: 500,
    extensions,
  })

  // patchListenHost must be called first so the key-mode wrapper below can
  // wrap the already-patched listen.
  patchListenHost(server)

  if (config.auth.mode === 'key') {
    const patchedListen = server.listen.bind(server)
    server.listen = async (port?: number, callback?: unknown): Promise<Hocuspocus> => {
      const result = await patchedListen(port, callback)

      const db = (sqlite as { db?: unknown }).db
      if (!db) throw new Error('SQLite database not initialized')

      const store = new KeyStore(db)
      runMigrations(db)

      server.hocuspocus.configuration.extensions.push(createIdentityRouteExtension(store))

      const verifier = createKeyVerifier(store)
      server.hocuspocus.configuration.extensions.push({
        async onAuthenticate({ token, requestParameters }) {
          const vaultId = requestParameters.get('vault') ?? 'default'
          return verifier.authenticate(token, vaultId)
        },
      })

      return result
    }
  }

  return server
}

function listPersistedDocumentIds(sqlite: SQLite): string[] {
  const rows = (sqlite.db?.prepare('SELECT name FROM documents ORDER BY name').all() ?? []) as unknown[]

  return rows
    .map((row): string | null => {
      if (typeof row === 'object' && row !== null && 'name' in row && typeof row.name === 'string') {
        return row.name
      }

      return null
    })
    .filter((documentId: string | null): documentId is string => documentId !== null)
}

function createVerboseLogger(): Extension {
  const tag = () => `[${new Date().toISOString()}]`
  return {
    onConnect: async ({ documentName, context }) => {
      console.log(tag(), 'connect  ', documentName, context?.user?.name ?? '')
    },
    onDisconnect: async ({ documentName, context }) => {
      console.log(tag(), 'disconnect', documentName, context?.user?.name ?? '')
    },
    onLoadDocument: async ({ documentName }) => {
      console.log(tag(), 'load     ', documentName)
    },
    onStoreDocument: async ({ documentName }) => {
      console.log(tag(), 'store    ', documentName)
    },
    onChange: async ({ documentName, update }) => {
      console.log(tag(), 'change   ', documentName, `${update.byteLength}b`)
    },
  }
}

function patchListenHost(server: Server): void {
  server.listen = async (port?: number, callback: unknown = null): Promise<Hocuspocus> => {
    if (port !== undefined) {
      server.configuration.port = port
    }

    if (typeof callback === 'function') {
      server.hocuspocus.configuration.extensions.push({
        onListen: callback as never,
      })
    }

    return new Promise((resolve, reject) => {
      server.httpServer.listen(
        {
          port: server.configuration.port,
          host: server.configuration.address,
        },
        async () => {
          try {
            await server.hocuspocus.hooks('onListen', {
              instance: server.hocuspocus,
              configuration: server.configuration,
              port: server.address.port,
            })
            resolve(server.hocuspocus)
          } catch (error) {
            reject(error)
          }
        },
      )
    })
  }
}
