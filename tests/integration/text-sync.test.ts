import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

  it('syncs edits to an existing markdown file', async () => {
    await clientA.write('notes/hello.md', '# Hello')
    await waitForContent(clientB.root, 'notes/hello.md', '# Hello')

    await clientA.write('notes/hello.md', '# Hello\n\nUpdated')

    await waitForContent(clientB.root, 'notes/hello.md', '# Hello\n\nUpdated')
  })

  it('syncs changes in both directions', async () => {
    await clientA.write('notes/hello.md', 'from A')
    await waitForContent(clientB.root, 'notes/hello.md', 'from A')

    await clientB.write('notes/hello.md', 'from B')

    await waitForContent(clientA.root, 'notes/hello.md', 'from B')
  })

  it('creates nested directories for remote documents', async () => {
    await clientA.write('a/b/c/deep.md', 'deep content')

    await waitForContent(clientB.root, 'a/b/c/deep.md', 'deep content')
  })

  it('round-trips empty and unicode content', async () => {
    await clientA.write('notes/empty.md', '')
    await clientA.write('notes/unicode.md', 'hello 世界 مرحبا')

    await waitForContent(clientB.root, 'notes/empty.md', '')
    await waitForContent(clientB.root, 'notes/unicode.md', 'hello 世界 مرحبا')
  })

  it('pushes files that exist before a watcher starts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'accord-preexisting-'))
    const notesDir = path.join(root, 'notes')
    await mkdir(notesDir, { recursive: true })
    await writeFile(path.join(notesDir, 'preexisting.md'), 'local before start', 'utf8')

    const clientC = await startTestWatcher(server.wsUrl, {
      root,
      userName: 'Preexisting Agent',
    })

    try {
      await waitForContent(clientB.root, 'notes/preexisting.md', 'local before start')
    } finally {
      await clientC.stop()
    }
  })
})
