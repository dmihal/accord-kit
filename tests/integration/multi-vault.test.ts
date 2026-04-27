import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './helpers/server.js'
import { waitForAbsence, waitForContent } from './helpers/sync.js'
import { startTestWatcher, type TestWatcher } from './helpers/watcher.js'

describe('multi-vault isolation', () => {
  let server: TestServer
  let vaultA: TestWatcher
  let vaultB: TestWatcher

  beforeEach(async () => {
    server = await startTestServer({
      vaults: ['default', 'team-a', 'team-b'],
    })
    vaultA = await startTestWatcher(server.wsUrl, { vault: 'team-a', userName: 'Agent A' })
    vaultB = await startTestWatcher(server.wsUrl, { vault: 'team-b', userName: 'Agent B' })
  })

  afterEach(async () => {
    await vaultA?.stop()
    await vaultB?.stop()
    await server?.stop()
  })

  it('keeps same-path documents isolated by vault', async () => {
    await vaultA.write('notes/shared.md', 'from A')
    await vaultB.write('notes/shared.md', 'from B')

    await waitForContent(vaultA.root, 'notes/shared.md', 'from A')
    await waitForContent(vaultB.root, 'notes/shared.md', 'from B')
  })

  it('scopes deletions to the originating vault', async () => {
    await vaultA.write('notes/deleted.md', 'A copy')
    await vaultB.write('notes/deleted.md', 'B copy')

    await waitForContent(vaultA.root, 'notes/deleted.md', 'A copy')
    await waitForContent(vaultB.root, 'notes/deleted.md', 'B copy')

    await vaultA.remove('notes/deleted.md')
    await waitForAbsence(vaultA.root, 'notes/deleted.md')
    await waitForContent(vaultB.root, 'notes/deleted.md', 'B copy')
  })

  it('lists documents per vault', async () => {
    await vaultA.write('notes/a.md', 'A doc')
    await vaultB.write('notes/b.md', 'B doc')

    await waitForContent(vaultA.root, 'notes/a.md', 'A doc')
    await waitForContent(vaultB.root, 'notes/b.md', 'B doc')

    const documentsA = await waitForJson<string[]>(`${server.httpUrl}/vaults/team-a/documents`)
    const documentsB = await waitForJson<string[]>(`${server.httpUrl}/vaults/team-b/documents`)

    expect(documentsA).toEqual(['notes/a.md'])
    expect(documentsB).toEqual(['notes/b.md'])
  })
})

async function waitForJson<T>(url: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastValue: T | undefined

  while (Date.now() < deadline) {
    const response = await fetch(url)
    if (response.status === 200) {
      const json = await response.json() as T
      lastValue = json
      if (Array.isArray(json) ? json.length > 0 : Boolean(json)) {
        return json
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  if (lastValue !== undefined) {
    return lastValue
  }

  throw new Error(`Timed out waiting for JSON from ${url}`)
}
