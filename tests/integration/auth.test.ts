import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createJwtTestKeys } from './helpers/auth.js'
import { startTestServer, type TestServer } from './helpers/server.js'
import { waitForContent } from './helpers/sync.js'
import { startTestWatcher, type TestWatcher } from './helpers/watcher.js'

describe('jwt auth', () => {
  let server: TestServer
  let watcher: TestWatcher | undefined
  let publicKeyPath: string
  let mintToken: ReturnType<typeof createJwtTestKeys> extends Promise<infer T> ? T['mintToken'] : never

  beforeEach(async () => {
    const keys = await createJwtTestKeys()
    publicKeyPath = keys.publicKeyPath
    mintToken = keys.mintToken

    server = await startTestServer({
      vaults: ['alpha', 'other'],
      auth: {
        mode: 'jwt',
        issuer: 'accord-kit',
        audience: 'accord-kit',
        publicKeyPath,
      },
    })
  })

  afterEach(async () => {
    await watcher?.stop()
    await server?.stop()
  })

  it('accepts a valid token for websocket sync', async () => {
    watcher = await startTestWatcher(server.wsUrl, {
      vault: 'alpha',
      token: mintToken({
        sub: 'user-1',
        vaults: ['alpha'],
        issuer: 'accord-kit',
        audience: 'accord-kit',
      }),
      userName: 'Alice',
    })

    await watcher.write('notes/auth.md', 'hello auth')
    await waitForContent(watcher.root, 'notes/auth.md', 'hello auth')
  })

  it('rejects websocket connections for the wrong vault claim', async () => {
    await expect(
      startTestWatcher(server.wsUrl, {
        vault: 'alpha',
        token: mintToken({
          sub: 'user-1',
          vaults: ['other'],
          issuer: 'accord-kit',
          audience: 'accord-kit',
        }),
        syncTimeoutMs: 1_000,
      }),
    ).rejects.toThrow()
  })

  it('rejects expired websocket tokens', async () => {
    const now = Math.floor(Date.now() / 1000)

    await expect(
      startTestWatcher(server.wsUrl, {
        vault: 'alpha',
        token: mintToken({
          sub: 'user-1',
          vaults: ['alpha'],
          issuer: 'accord-kit',
          audience: 'accord-kit',
          issuedAt: now - 100,
          expiresAt: now - 10,
        }),
        syncTimeoutMs: 1_000,
      }),
    ).rejects.toThrow()
  })

  it('requires a bearer token for document listings', async () => {
    const response = await fetch(`${server.httpUrl}/vaults/alpha/documents`)

    expect(response.status).toBe(401)
  })

  it('enforces the vault claim for document listings', async () => {
    const response = await fetch(`${server.httpUrl}/vaults/alpha/documents`, {
      headers: {
        Authorization: `Bearer ${mintToken({
          sub: 'user-1',
          vaults: ['other'],
          issuer: 'accord-kit',
          audience: 'accord-kit',
        })}`,
      },
    })

    expect(response.status).toBe(403)
  })
})
