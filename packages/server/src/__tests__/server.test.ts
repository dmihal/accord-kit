import { describe, expect, it } from 'vitest'
import { defaultServerConfig } from '../config.js'
import { createAccordServer } from '../server.js'

describe('createAccordServer', () => {
  it('creates a Hocuspocus server with AccordKit defaults', async () => {
    const server = createAccordServer(defaultServerConfig())

    expect(server.configuration.address).toBe('127.0.0.1')
    expect(server.configuration.port).toBe(1234)
    expect(server.configuration.extensions.map((extension) => extension.extensionName)).toContain(
      'AccordKitDocumentsRoute',
    )

    await server.destroy()
  })
})
