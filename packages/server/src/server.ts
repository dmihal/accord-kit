import { Server, type Extension, type Hocuspocus } from '@hocuspocus/server'
import { AccordAuth, type AccordConnectionContext } from './auth/index.js'
import { KeyStore, runMigrations } from './auth/key-store.js'
import type { AccordServerConfig } from './config.js'
import { createDocumentsRouteExtension, createIdentityRouteExtension } from './routes.js'
import { createAccordStorageExtension, createStorageDriver, type StorageDriver, SQLiteDriver } from './storage/index.js'

export interface AccordServer extends Server<AccordConnectionContext> {
  accord: {
    auth: AccordAuth
    storage: StorageDriver
    keyStore?: KeyStore
  }
}

export function createAccordServer(config: AccordServerConfig): AccordServer {
  const storage = createStorageDriver(config.storage)
  const keyStore = config.auth.mode === 'key' ? createKeyStore(storage) : undefined
  const auth = new AccordAuth(config.auth, storage, keyStore)
  const ready = setupStorage(storage, keyStore)

  const extensions: Extension<AccordConnectionContext>[] = [
    {
      extensionName: 'AccordKitBootstrap',
      async onListen() {
        await ready
      },
      async onAuthenticate({ request, context, token }) {
        await ready
        await auth.authenticateWebSocket({ request, context, token })
      },
      async onDestroy() {
        await storage.destroy()
      },
    },
    createDocumentsRouteExtension({
      auth,
      storage,
    }),
    createAccordStorageExtension(storage),
  ]

  if (keyStore) {
    extensions.push(createIdentityRouteExtension(keyStore))
  }

  if (config.verbose) {
    extensions.unshift(createVerboseLogger())
  }

  extensions.push({
    extensionName: 'AccordKitAuthModeLogger',
    async onListen() {
      console.log(`Auth mode: ${config.auth.mode}`)
    },
  })

  const server = new Server<AccordConnectionContext>({
    address: config.address,
    port: config.port,
    quiet: config.quiet,
    debounce: 100,
    maxDebounce: 500,
    extensions,
  }) as AccordServer

  server.accord = {
    auth,
    storage,
    keyStore,
  }

  patchListenHost(server)
  return server
}

async function setupStorage(storage: StorageDriver, keyStore?: KeyStore): Promise<void> {
  if (keyStore) {
    const sqliteStorage = storage as SQLiteDriver
    runMigrations(sqliteStorage.getDb())
  }

  await storage.setup()
}

function createKeyStore(storage: StorageDriver): KeyStore {
  if (!(storage instanceof SQLiteDriver)) {
    throw new Error('auth.mode=key requires storage.driver=sqlite')
  }

  return new KeyStore(storage.getDb())
}

function createVerboseLogger(): Extension<AccordConnectionContext> {
  const tag = () => `[${new Date().toISOString()}]`
  return {
    onConnect: async ({ documentName, context }) => {
      console.log(tag(), 'connect  ', documentName, context?.userName ?? '')
    },
    onDisconnect: async ({ documentName, context }) => {
      console.log(tag(), 'disconnect', documentName, context?.userName ?? '')
    },
    onLoadDocument: async ({ documentName, context }) => {
      console.log(tag(), 'load     ', documentName, context?.vaultId ?? '')
    },
    onStoreDocument: async ({ documentName }) => {
      console.log(tag(), 'store    ', documentName)
    },
    onChange: async ({ documentName, update }) => {
      console.log(tag(), 'change   ', documentName, `${update.byteLength}b`)
    },
  }
}

function patchListenHost(server: Server<AccordConnectionContext>): void {
  server.listen = async (port?: number, callback: unknown = null): Promise<Hocuspocus<AccordConnectionContext>> => {
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
