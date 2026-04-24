import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './helpers/server.js'
import { waitForContent } from './helpers/sync.js'
import { startTestWatcher, type TestWatcher } from './helpers/watcher.js'

describe('text sync', () => {
  let server: TestServer
  let clientA: TestWatcher
  let clientB: TestWatcher

  beforeEach(async () => {
    server = await startTestServer()
    clientA = await startTestWatcher(server.wsUrl, { userName: 'Agent' })
    clientB = await startTestWatcher(server.wsUrl, { userName: 'Human' })
  })

  afterEach(async () => {
    await clientA?.stop()
    await clientB?.stop()
    await server?.stop()
  })

  it('syncs a new markdown file from A to B', async () => {
    await clientA.write('notes/hello.md', '# Hello')

    await waitForContent(clientB.root, 'notes/hello.md', '# Hello')
    await expect(clientB.read('notes/hello.md')).resolves.toBe('# Hello')
  })
})
