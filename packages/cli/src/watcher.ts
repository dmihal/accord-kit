import {
  assertSafeDocumentId,
  createIgnoreMatcher,
  type IgnoreMatcher,
  isTextPath,
  normalizeDocumentId,
  toDocumentId,
} from '@accord-kit/core'
import chokidar, { type FSWatcher } from 'chokidar'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type * as Y from 'yjs'
import { DocPool } from './sync.js'

export interface WatcherConfig {
  root: string
  serverUrl: string
  userName: string
  ignorePatterns?: string[]
  manifestPollMs?: number
}

export interface AccordWatcher {
  stop: () => Promise<void>
}

export async function startAccordWatcher(config: WatcherConfig): Promise<AccordWatcher> {
  await mkdir(config.root, { recursive: true })

  const watcher = new TextFileWatcher(config)
  await watcher.start()
  return watcher
}

class TextFileWatcher implements AccordWatcher {
  private readonly ignoreMatcher: IgnoreMatcher
  private readonly docPool: DocPool
  private readonly knownDocuments = new Set<string>()
  private readonly observedDocuments = new Set<string>()
  private readonly recentWrites = new Map<string, string>()
  private readonly manifestUrl: string
  private watcher?: FSWatcher
  private manifestInterval?: NodeJS.Timeout

  constructor(private readonly config: WatcherConfig) {
    this.ignoreMatcher = createIgnoreMatcher(config.ignorePatterns)
    this.docPool = new DocPool({
      serverUrl: config.serverUrl,
      userName: config.userName,
    })
    this.manifestUrl = new URL('/documents', config.serverUrl.replace(/^ws/, 'http')).toString()
  }

  async start(): Promise<void> {
    this.watcher = chokidar.watch(this.config.root, {
      ignoreInitial: true,
      ignored: (candidatePath) => this.shouldIgnoreAbsolutePath(candidatePath),
    })

    this.watcher.on('add', (filePath) => {
      void this.handleLocalChange(filePath)
    })
    this.watcher.on('change', (filePath) => {
      void this.handleLocalChange(filePath)
    })

    await this.scanLocalFiles()
    await this.pollManifest()
    this.manifestInterval = setInterval(() => {
      void this.pollManifest()
    }, this.config.manifestPollMs ?? 500)
  }

  async stop(): Promise<void> {
    if (this.manifestInterval) clearInterval(this.manifestInterval)
    await this.watcher?.close()
    this.docPool.destroy()
  }

  private async handleLocalChange(filePath: string): Promise<void> {
    const documentId = this.documentIdForPath(filePath)
    if (!documentId || !this.shouldSync(documentId)) return

    const content = await readFile(filePath, 'utf8')
    if (this.recentWrites.get(documentId) === content) {
      this.recentWrites.delete(documentId)
      return
    }

    this.knownDocuments.add(documentId)
    this.attachRemoteWriter(documentId)
    await this.docPool.applyContent(documentId, content)
  }

  private async scanLocalFiles(): Promise<void> {
    const filePaths = await this.walkFiles(this.config.root)

    await Promise.all(
      filePaths.map(async (filePath) => {
        await this.handleLocalChange(filePath)
      }),
    )
  }

  private async walkFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const filePaths: string[] = []

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name)
        const documentId = this.documentIdForPath(entryPath)

        if (documentId && !this.shouldSync(documentId)) return

        if (entry.isDirectory()) {
          filePaths.push(...(await this.walkFiles(entryPath)))
        } else if (entry.isFile()) {
          filePaths.push(entryPath)
        }
      }),
    )

    return filePaths
  }

  private async pollManifest(): Promise<void> {
    const response = await fetch(this.manifestUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch document manifest: ${response.status}`)
    }

    const documentIds = (await response.json()) as string[]
    await Promise.all(
      documentIds.map(async (documentId) => {
        const safeDocumentId = assertSafeDocumentId(documentId)
        if (this.knownDocuments.has(safeDocumentId) || !this.shouldSync(safeDocumentId)) return

        this.knownDocuments.add(safeDocumentId)
        const handle = this.attachRemoteWriter(safeDocumentId)
        await handle.synced
        await this.writeRemoteContent(safeDocumentId, handle.yText.toString())
      }),
    )
  }

  private attachRemoteWriter(documentId: string): { yText: Y.Text; synced: Promise<void> } {
    const handle = this.docPool.open(documentId)
    if (this.observedDocuments.has(documentId)) return handle

    this.observedDocuments.add(documentId)
    handle.yText.observe((_event, transaction) => {
      if (transaction.local) return
      void this.writeRemoteContent(documentId, handle.yText.toString())
    })

    return handle
  }

  private async writeRemoteContent(documentId: string, content: string): Promise<void> {
    const localPath = path.join(this.config.root, ...documentId.split('/'))
    await mkdir(path.dirname(localPath), { recursive: true })
    this.recentWrites.set(documentId, content)
    await writeFile(localPath, content, 'utf8')
  }

  private shouldIgnoreAbsolutePath(candidatePath: string): boolean {
    const documentId = this.documentIdForPath(candidatePath)
    return documentId ? !this.shouldSync(documentId) : false
  }

  private shouldSync(documentId: string): boolean {
    return isTextPath(documentId) && !this.ignoreMatcher.ignores(documentId)
  }

  private documentIdForPath(filePath: string): string | null {
    try {
      return normalizeDocumentId(toDocumentId(this.config.root, filePath))
    } catch {
      return null
    }
  }
}
