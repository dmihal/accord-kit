import { startAccordWatcher, type AccordWatcher, type WatcherConfig } from '@accord-kit/cli'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface TestWatcher {
  root: string
  stop: () => Promise<void>
  write: (relPath: string, content: string) => Promise<void>
  read: (relPath: string) => Promise<string>
}

export async function startTestWatcher(
  serverUrl: string,
  options: Partial<WatcherConfig> = {},
): Promise<TestWatcher> {
  const root = options.root ?? (await mkdtemp(path.join(tmpdir(), 'accord-watcher-')))
  const watcher: AccordWatcher = await startAccordWatcher({
    root,
    serverUrl,
    userName: options.userName ?? 'Test User',
    manifestPollMs: options.manifestPollMs ?? 100,
    ignorePatterns: options.ignorePatterns,
  })

  return {
    root,
    stop: async () => {
      await watcher.stop()
      await rm(root, { recursive: true, force: true })
    },
    write: async (relPath: string, content: string) => {
      const target = path.join(root, ...relPath.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    },
    read: async (relPath: string) => {
      return readFile(path.join(root, ...relPath.split('/')), 'utf8')
    },
  }
}
