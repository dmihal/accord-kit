import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access } from 'node:fs/promises'
import { startTestServer, type TestServer } from './helpers/server.js'
import { waitForAbsence, waitForContent } from './helpers/sync.js'
import { startTestWatcher, type TestWatcher } from './helpers/watcher.js'

describe('file lifecycle', () => {
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

  it('moves remotely deleted files to local trash with content preserved', async () => {
    await clientA.write('notes/deleted.md', 'keep this copy')
    await waitForContent(clientB.root, 'notes/deleted.md', 'keep this copy')

    await clientA.remove('notes/deleted.md')

    await waitForAbsence(clientB.root, 'notes/deleted.md')
    await waitForContent(clientB.root, '.accord-trash/notes/deleted.md', 'keep this copy')
  })

  it('supports hard delete behavior', async () => {
    await clientA.stop()
    await clientB.stop()
    clientA = await startTestWatcher(server.wsUrl, { userName: 'Agent' })
    clientB = await startTestWatcher(server.wsUrl, {
      userName: 'Human',
      deletionBehavior: 'delete',
    })

    await clientA.write('notes/deleted.md', 'remove this copy')
    await waitForContent(clientB.root, 'notes/deleted.md', 'remove this copy')

    await clientA.remove('notes/deleted.md')

    await waitForAbsence(clientB.root, 'notes/deleted.md')
    await expect(access(`${clientB.root}/.accord-trash/notes/deleted.md`)).rejects.toThrow()
  })

  it('does not sync ignored files or local trash contents', async () => {
    await clientA.write('.DS_Store', 'ignored')
    await clientA.write('.accord-trash/local.md', 'trash is local')
    await clientA.write('notes/real.md', 'real')

    await waitForContent(clientB.root, 'notes/real.md', 'real')
    await expect(access(`${clientB.root}/.DS_Store`)).rejects.toThrow()
    await expect(access(`${clientB.root}/.accord-trash/local.md`)).rejects.toThrow()
  })
})
