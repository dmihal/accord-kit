import { SQLite } from '@hocuspocus/extension-sqlite'
import { Server } from '@hocuspocus/server'
import type { AccordServerConfig } from './config.js'

export function createAccordServer(config: AccordServerConfig): Server {
  return new Server({
    address: config.address,
    port: config.port,
    quiet: config.quiet,
    extensions: [
      new SQLite({
        database: config.persistence.path,
      }),
    ],
  })
}
