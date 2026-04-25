import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './helpers/server.js'
import { waitForContent } from './helpers/sync.js'
import { startTestWatcher, type TestWatcher } from './helpers/watcher.js'

type AwarenessStates = Map<number, Record<string, unknown>>

function waitForAwareness(
  states: () => AwarenessStates,
  predicate: (states: AwarenessStates) => boolean,
  onChange: (handler: () => void) => void,
  offChange: (handler: () => void) => void,
  timeoutMs = 5_000,
): Promise<void> {
  if (predicate(states())) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      offChange(handler)
      reject(new Error('Timed out waiting for awareness state'))
    }, timeoutMs)
    function handler() {
      if (predicate(states())) {
        clearTimeout(timer)
        offChange(handler)
        resolve()
      }
    }
    onChange(handler)
  })
}

describe('awareness', () => {
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

  it('returns provider for an open document', async () => {
    await clientA.write('notes/hello.md', 'content')
    await waitForContent(clientB.root, 'notes/hello.md', 'content')

    expect(clientA.getProvider('notes/hello.md')).toBeDefined()
    expect(clientB.getProvider('notes/hello.md')).toBeDefined()
  })

  it('returns undefined for a document that has not been opened', () => {
    expect(clientA.getProvider('never-opened.md')).toBeUndefined()
  })

  it('propagates awareness state to other clients', async () => {
    await clientA.write('notes/shared.md', 'content')
    await waitForContent(clientB.root, 'notes/shared.md', 'content')

    const providerA = clientA.getProvider('notes/shared.md')!
    const providerB = clientB.getProvider('notes/shared.md')!
    const awarenessB = providerB.awareness!

    providerA.setAwarenessField('cursor', { index: 42 })

    await waitForAwareness(
      () => awarenessB.getStates() as AwarenessStates,
      (states) => [...states.values()].some((s) => (s.cursor as { index?: number })?.index === 42),
      (h) => awarenessB.on('change', h),
      (h) => awarenessB.off('change', h),
    )
  })

  it('reflects clearing cursor field on remote clients', async () => {
    await clientA.write('notes/shared.md', 'content')
    await waitForContent(clientB.root, 'notes/shared.md', 'content')

    const providerA = clientA.getProvider('notes/shared.md')!
    const providerB = clientB.getProvider('notes/shared.md')!
    const awarenessB = providerB.awareness!

    providerA.setAwarenessField('cursor', { index: 7 })
    await waitForAwareness(
      () => awarenessB.getStates() as AwarenessStates,
      (states) => [...states.values()].some((s) => (s.cursor as { index?: number })?.index === 7),
      (h) => awarenessB.on('change', h),
      (h) => awarenessB.off('change', h),
    )

    providerA.setAwarenessField('cursor', null)
    await waitForAwareness(
      () => awarenessB.getStates() as AwarenessStates,
      (states) => ![...states.values()].some((s) => (s.cursor as { index?: number })?.index === 7),
      (h) => awarenessB.on('change', h),
      (h) => awarenessB.off('change', h),
    )
  })

  it('removes awareness entry when a client disconnects', async () => {
    await clientA.write('notes/shared.md', 'content')
    await waitForContent(clientB.root, 'notes/shared.md', 'content')

    const providerA = clientA.getProvider('notes/shared.md')!
    const providerB = clientB.getProvider('notes/shared.md')!
    const awarenessB = providerB.awareness!
    const clientAId = providerA.awareness!.clientID

    providerA.setAwarenessField('cursor', { index: 99 })
    await waitForAwareness(
      () => awarenessB.getStates() as AwarenessStates,
      (states) => states.has(clientAId),
      (h) => awarenessB.on('change', h),
      (h) => awarenessB.off('change', h),
    )

    await clientA.stop()
    // Prevent afterEach from double-stopping clientA
    clientA = null as unknown as TestWatcher

    await waitForAwareness(
      () => awarenessB.getStates() as AwarenessStates,
      (states) => !states.has(clientAId),
      (h) => awarenessB.on('change', h),
      (h) => awarenessB.off('change', h),
    )
  })

  it('includes color in user awareness field', async () => {
    await clientA.write('notes/color.md', 'content')
    await waitForContent(clientB.root, 'notes/color.md', 'content')

    const providerB = clientB.getProvider('notes/color.md')!
    const awarenessB = providerB.awareness!
    const clientAId = clientA.getProvider('notes/color.md')!.awareness!.clientID

    const stateA = awarenessB.getStates().get(clientAId)
    expect(stateA?.user).toMatchObject({ name: 'Agent', color: expect.stringMatching(/^hsl\(/) })
  })
})
