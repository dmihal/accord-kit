import {
  assertSafeDocumentId,
  createIgnoreMatcher,
  type IgnoreMatcher,
  isTextPath,
  normalizeDocumentId,
  resolveSafeStoragePath,
  toDocumentId,
} from '@accord-kit/core'
import chokidar, { type FSWatcher } from 'chokidar'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'
import { DocPool } from './sync.js'

export interface WatcherConfig {
  root: string
  serverUrl: string
  userName: string
  token?: string
  vaultId?: string
  ignorePatterns?: string[]
  manifestPollMs?: number
  deletionBehavior?: 'trash' | 'delete'
}

export interface AccordWatcher {
  stop: () => Promise<void>
  getProvider: (documentId: string) => HocuspocusProvider | undefined
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
  private readonly locallyDeletedDocuments = new Set<string>()
  private readonly recentWrites = new Map<string, string>()
  private readonly pendingLocalChanges = new Map<string, NodeJS.Timeout>()
  private readonly directoryScanTimers = new Set<NodeJS.Timeout>()
  private readonly manifestUrl: string
  private metadata?: { map: Y.Map<DeletionRecord>; synced: Promise<void> }
  private watcher?: FSWatcher
  private manifestInterval?: NodeJS.Timeout

  constructor(private readonly config: WatcherConfig) {
    this.ignoreMatcher = createIgnoreMatcher(config.ignorePatterns)
    this.docPool = new DocPool({
      serverUrl: config.serverUrl,
      userName: config.userName,
      token: config.token,
      vaultId: config.vaultId,
    })
    this.manifestUrl = new URL('/documents', config.serverUrl.replace(/^ws/, 'http')).toString()
  }

  async start(): Promise<void> {
    this.watcher = chokidar.watch(this.config.root, {
      ignoreInitial: true,
      ignored: (candidatePath) => this.shouldIgnoreAbsolutePath(candidatePath),
    })

    this.watcher.on('add', (filePath) => {
      this.scheduleLocalChange(filePath)
    })
    this.watcher.on('change', (filePath) => {
      this.scheduleLocalChange(filePath)
    })
    this.watcher.on('unlink', (filePath) => {
      void this.handleLocalDelete(filePath)
    })
    this.watcher.on('addDir', (directoryPath) => {
      this.scheduleDirectoryScan(directoryPath)
    })

    await waitForWatcherReady(this.watcher)
    await this.initializeDeletionMetadata()
    await this.scanLocalFiles()
    await this.pollManifest()
    this.manifestInterval = setInterval(() => {
      void this.pollManifest()
    }, this.config.manifestPollMs ?? 500)
  }

  getProvider(documentId: string): HocuspocusProvider | undefined {
    return this.docPool.getProvider(documentId)
  }

  async stop(): Promise<void> {
    if (this.manifestInterval) clearInterval(this.manifestInterval)
    for (const timer of this.directoryScanTimers) clearTimeout(timer)
    for (const timer of this.pendingLocalChanges.values()) clearTimeout(timer)
    await this.watcher?.close()
    this.docPool.destroy()
  }

  private scheduleLocalChange(filePath: string): void {
    const existing = this.pendingLocalChanges.get(filePath)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pendingLocalChanges.delete(filePath)
      void this.handleLocalChange(filePath)
    }, 80)
    this.pendingLocalChanges.set(filePath, timer)
  }

  private async handleLocalChange(filePath: string): Promise<void> {
    const documentId = this.documentIdForPath(filePath)
    if (!documentId || !this.shouldSync(documentId)) return

    const content = await readFile(filePath, 'utf8')
    if (this.recentWrites.get(documentId) === content) {
      this.recentWrites.delete(documentId)
      return
    }

    this.clearDeletionRecord(documentId)
    this.knownDocuments.add(documentId)
    this.attachRemoteWriter(documentId)
    await this.docPool.applyContent(documentId, content)
  }

  private async handleLocalDelete(filePath: string): Promise<void> {
    const documentId = this.documentIdForPath(filePath)
    if (!documentId || !this.shouldSync(documentId)) return
    if (this.locallyDeletedDocuments.has(documentId)) {
      this.locallyDeletedDocuments.delete(documentId)
      return
    }

    this.knownDocuments.delete(documentId)
    this.docPool.close(documentId)
    await this.setDeletionRecord(documentId)
  }

  private async scanLocalFiles(): Promise<void> {
    const filePaths = await this.walkFiles(this.config.root)

    await Promise.all(
      filePaths.map(async (filePath) => {
        await this.handleLocalChange(filePath)
      }),
    )
  }

  private scheduleDirectoryScan(directoryPath: string): void {
    if (this.shouldIgnoreAbsolutePath(directoryPath)) return

    const timer = setTimeout(() => {
      this.directoryScanTimers.delete(timer)
      void this.scanDirectory(directoryPath)
    }, 50)

    this.directoryScanTimers.add(timer)
  }

  private async scanDirectory(directoryPath: string): Promise<void> {
    const filePaths = await this.walkFiles(directoryPath)

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
    const documentIds = await httpGetJson<string[]>(this.manifestUrl)
    await Promise.all(
      documentIds.map(async (documentId) => {
        const safeDocumentId = assertSafeDocumentId(documentId)
        if (this.knownDocuments.has(safeDocumentId) || !this.shouldSync(safeDocumentId)) return
        if (this.isDeleted(safeDocumentId)) return

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
    if (this.isDeleted(documentId)) return

    const localPath = path.join(this.config.root, ...documentId.split('/'))
    await mkdir(path.dirname(localPath), { recursive: true })
    this.recentWrites.set(documentId, content)
    await writeFile(localPath, content, 'utf8')
  }

  private async initializeDeletionMetadata(): Promise<void> {
    const handle = this.docPool.open('__accord_metadata')
    this.metadata = {
      map: handle.ydoc.getMap<DeletionRecord>('deletions'),
      synced: handle.synced,
    }
    try {
      await handle.synced
    } catch {
      throw new Error(`Could not connect to AccordKit server at ${this.config.serverUrl}. Is it running?`)
    }

    this.metadata.map.observe((event) => {
      for (const key of event.keysChanged) {
        const record = this.metadata?.map.get(key)
        if (record?.deleted) {
          void this.applyRemoteDeletion(key)
        }
      }
    })

    await Promise.all(
      [...this.metadata.map.entries()].map(async ([documentId, record]) => {
        if (record.deleted) await this.applyRemoteDeletion(documentId)
      }),
    )
  }

  private async setDeletionRecord(documentId: string): Promise<void> {
    if (!this.metadata) return
    await this.metadata.synced
    this.metadata.map.set(documentId, {
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: this.config.userName,
    })
  }

  private isDeleted(documentId: string): boolean {
    return this.metadata?.map.get(documentId)?.deleted === true
  }

  private clearDeletionRecord(documentId: string): void {
    if (this.metadata?.map.get(documentId)?.deleted) {
      this.metadata.map.delete(documentId)
    }
  }

  private async applyRemoteDeletion(documentId: string): Promise<void> {
    if (!this.shouldSync(documentId)) return

    const localPath = path.join(this.config.root, ...documentId.split('/'))
    const trashPath = resolveSafeStoragePath(path.join(this.config.root, '.accord-trash'), documentId)

    try {
      if (this.config.deletionBehavior === 'delete') {
        this.locallyDeletedDocuments.add(documentId)
        await rm(localPath, { force: true })
      } else {
        await mkdir(path.dirname(trashPath), { recursive: true })
        this.locallyDeletedDocuments.add(documentId)
        await rename(localPath, trashPath)
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }

    this.knownDocuments.delete(documentId)
    this.docPool.close(documentId)
  }

  private shouldIgnoreAbsolutePath(candidatePath: string): boolean {
    const documentId = this.documentIdForPath(candidatePath)
    return documentId ? !this.shouldSync(documentId) : false
  }

  private shouldSync(documentId: string): boolean {
    return !documentId.startsWith('__accord_') && isTextPath(documentId) && !this.ignoreMatcher.ignores(documentId)
  }

  private documentIdForPath(filePath: string): string | null {
    try {
      return normalizeDocumentId(toDocumentId(this.config.root, filePath))
    } catch {
      return null
    }
  }
}

interface DeletionRecord {
  deleted: boolean
  deletedAt: string
  deletedBy: string
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve) => {
    watcher.once('ready', resolve)
  })
}

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch document manifest: ${res.statusCode}`))
        res.resume()
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body) as T) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}
