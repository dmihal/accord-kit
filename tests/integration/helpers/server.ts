import { createAccordServer, defaultServerConfig } from '@accord-kit/server'

export interface TestServer {
  wsUrl: string
  httpUrl: string
  stop: () => Promise<void>
}

export interface StartTestServerOptions {
  sqlitePath?: string
}

export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  const server = createAccordServer({
    ...defaultServerConfig(),
    port: 0,
    persistence: {
      path: options.sqlitePath ?? ':memory:',
    },
    quiet: true,
  })

  await server.listen()

  return {
    wsUrl: server.webSocketURL,
    httpUrl: server.httpURL,
    stop: async () => {
      await server.destroy()
    },
  }
}
