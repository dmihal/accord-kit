import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startTestServer, type TestServer } from './helpers/server.js'
import { waitForContent } from './helpers/sync.js'
import { startTestWatcher, type TestWatcher } from './helpers/watcher.js'

interface HookRecord {
  prompt: string
}

describe('on-change hook', () => {
  let server: TestServer
  let watchers: TestWatcher[]
  let hookDir: string

  beforeEach(async () => {
    server = await startTestServer()
    watchers = []
    hookDir = await mkdtemp(path.join(tmpdir(), 'accord-hook-'))
  })

  afterEach(async () => {
    await Promise.all(watchers.map(async (watcher) => watcher.stop()))
    await rm(hookDir, { recursive: true, force: true })
    await server?.stop()
  })

  it('runs the hook for remote changes with the expected prompt format', async () => {
    const clientA = await startWatcher(server.wsUrl, watchers, { userName: 'Agent' })
    const outputPath = path.join(hookDir, 'remote.jsonl')
    const clientB = await startWatcher(server.wsUrl, watchers, {
      userName: 'Human',
      onChangeCommand: createHookCommand(outputPath),
      onChangePrefix: 'You are watching shared docs.',
    })

    await clientA.write('notes/hello.md', '# Hello')
    await waitForContent(clientB.root, 'notes/hello.md', '# Hello')

    const [record] = await waitForHookRecords(outputPath, 1)
    expect(record?.prompt).toContain('You are watching shared docs.\n\nThe following documents changed:\n\n')
    expect(record?.prompt).toContain('--- notes/hello.md')
    expect(record?.prompt).toContain('+++ notes/hello.md')
    expect(record?.prompt).toContain('@@ -0,0 +1,1 @@')
    expect(record?.prompt).toContain('+# Hello')
    expect(record?.prompt).not.toContain('Index: notes/hello.md')
  })

  it('does not run the hook for initial sync content', async () => {
    const clientA = await startWatcher(server.wsUrl, watchers, { userName: 'Agent' })
    const seededClient = await startWatcher(server.wsUrl, watchers, { userName: 'Seeder' })
    await clientA.write('notes/bootstrap.md', 'existing content')
    await waitForContent(seededClient.root, 'notes/bootstrap.md', 'existing content')

    const outputPath = path.join(hookDir, 'initial.jsonl')
    const clientB = await startWatcher(server.wsUrl, watchers, {
      userName: 'Human',
      onChangeCommand: createHookCommand(outputPath),
    })

    await waitForContent(clientB.root, 'notes/bootstrap.md', 'existing content')
    await expectNoHookRecords(outputPath)
  })

  it('does not run the hook for local edits', async () => {
    const clientA = await startWatcher(server.wsUrl, watchers, { userName: 'Agent' })
    const outputPath = path.join(hookDir, 'local.jsonl')
    const clientB = await startWatcher(server.wsUrl, watchers, {
      userName: 'Human',
      onChangeCommand: createHookCommand(outputPath),
    })

    await clientB.write('notes/local.md', 'from local watcher')
    await waitForContent(clientA.root, 'notes/local.md', 'from local watcher')
    await expectNoHookRecords(outputPath)
  })

  it('coalesces remote changes that arrive while the hook is still running', async () => {
    const clientA = await startWatcher(server.wsUrl, watchers, { userName: 'Agent' })
    const outputPath = path.join(hookDir, 'queued.jsonl')
    const startedPath = path.join(hookDir, 'queued-started.jsonl')
    const clientB = await startWatcher(server.wsUrl, watchers, {
      userName: 'Human',
      onChangeCommand: createHookCommand(outputPath, startedPath, 400),
    })

    await clientA.write('notes/queued.md', 'v1')
    await waitForHookStarts(startedPath, 1)

    await clientA.write('notes/queued.md', 'v2')
    await clientA.write('notes/queued.md', 'v3')
    await waitForContent(clientB.root, 'notes/queued.md', 'v3')

    const records = await waitForHookRecords(outputPath, 2)
    expect(records).toHaveLength(2)
    expect(records[0]?.prompt).toContain('--- notes/queued.md')
    expect(records[0]?.prompt).toContain('+v1')
    expect(records[1]?.prompt).toContain('--- notes/queued.md')
    expect(records[1]?.prompt).toContain('-v1')
    expect(records[1]?.prompt).toContain('+v3')
    expect(records[1]?.prompt).not.toContain('v2')
  })
})

const hookScriptPath = fileURLToPath(new URL('./helpers/on-change-hook-runner.mjs', import.meta.url))

function createHookCommand(outputPath: string, startedPath?: string, delayMs = 0): string {
  const args = [hookScriptPath, outputPath, startedPath ?? '-', String(delayMs)].map((value) => JSON.stringify(value))
  return `node ${args.join(' ')}`
}

async function startWatcher(
  serverUrl: string,
  watchers: TestWatcher[],
  options: Parameters<typeof startTestWatcher>[1],
): Promise<TestWatcher> {
  const watcher = await startTestWatcher(serverUrl, options)
  watchers.push(watcher)
  return watcher
}

async function waitForHookRecords(outputPath: string, expectedCount: number, timeoutMs = 5_000): Promise<HookRecord[]> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const records = await readHookRecords(outputPath)
    if (records.length >= expectedCount) return records
    await delay(50)
  }

  throw new Error(`Timed out waiting for ${expectedCount} hook record(s)`)
}

async function waitForHookStarts(startedPath: string, expectedCount: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const lines = await readJsonLines(startedPath)
    if (lines.length >= expectedCount) return
    await delay(25)
  }

  throw new Error(`Timed out waiting for ${expectedCount} hook start(s)`)
}

async function expectNoHookRecords(outputPath: string, settleMs = 500): Promise<void> {
  await delay(settleMs)
  await expect(readHookRecords(outputPath)).resolves.toHaveLength(0)
}

async function readHookRecords(outputPath: string): Promise<HookRecord[]> {
  const lines = await readJsonLines(outputPath)
  return lines.map((line) => JSON.parse(line) as HookRecord)
}

async function readJsonLines(filePath: string): Promise<string[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
