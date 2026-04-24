import { SQLite } from '@hocuspocus/extension-sqlite'
import { Server, type Hocuspocus } from '@hocuspocus/server'
import type { AccordServerConfig } from './config.js'
import { createDocumentsRouteExtension } from './routes.js'

export function createAccordServer(config: AccordServerConfig): Server {
  const server = new Server({
    address: config.address,
    port: config.port,
    quiet: config.quiet,
    extensions: [
      createDocumentsRouteExtension(),
      new SQLite({
        database: config.persistence.path,
      }),
    ],
  })

  patchListenHost(server)
  return server
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
