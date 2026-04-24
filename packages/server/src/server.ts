import { SQLite } from '@hocuspocus/extension-sqlite'
import { Server, type Hocuspocus } from '@hocuspocus/server'
import type { AccordServerConfig } from './config.js'
import { createDocumentsRouteExtension } from './routes.js'

export function createAccordServer(config: AccordServerConfig): Server {
  const sqlite = new SQLite({
    database: config.persistence.path,
  })
  const server = new Server({
    address: config.address,
    port: config.port,
    quiet: config.quiet,
    debounce: 100,
    maxDebounce: 500,
    extensions: [
      createDocumentsRouteExtension({
        documentIds: new Set(),
        getPersistedDocumentIds: () => listPersistedDocumentIds(sqlite),
      }),
      sqlite,
    ],
  })

  patchListenHost(server)
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
