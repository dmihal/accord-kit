import { applyFileContent } from '@accord-kit/core'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

export interface DocPoolConfig {
  serverUrl: string
  userName: string
  syncTimeoutMs?: number
}

export interface TextDocumentHandle {
  documentId: string
  ydoc: Y.Doc
  yText: Y.Text
  provider: HocuspocusProvider
  synced: Promise<void>
}

interface StoredDocument {
  handle: TextDocumentHandle
  resolveSynced: () => void
  rejectSynced: (error: Error) => void
  syncTimer: NodeJS.Timeout
}

export class DocPool {
  private readonly docs = new Map<string, StoredDocument>()
  private readonly syncTimeoutMs: number

  constructor(private readonly config: DocPoolConfig) {
    this.syncTimeoutMs = config.syncTimeoutMs ?? 5_000
  }

  open(documentId: string): TextDocumentHandle {
    const existing = this.docs.get(documentId)
    if (existing) return existing.handle

    const ydoc = new Y.Doc()
    const yText = ydoc.getText('content')
    let resolveSynced!: () => void
    let rejectSynced!: (error: Error) => void
    const synced = new Promise<void>((resolve, reject) => {
      resolveSynced = resolve
      rejectSynced = reject
    })
    const syncTimer = setTimeout(() => {
      rejectSynced(new Error(`Timed out syncing "${documentId}"`))
    }, this.syncTimeoutMs)

    const provider = new HocuspocusProvider({
      url: this.config.serverUrl,
      name: documentId,
      document: ydoc,
      onSynced: ({ state }) => {
        if (!state) return
        clearTimeout(syncTimer)
        resolveSynced()
      },
    })

    provider.setAwarenessField('user', {
      name: this.config.userName,
      type: 'cli',
    })

    const handle = {
      documentId,
      ydoc,
      yText,
      provider,
      synced,
    }

    this.docs.set(documentId, {
      handle,
      resolveSynced,
      rejectSynced,
      syncTimer,
    })

    return handle
  }

  async applyContent(documentId: string, content: string): Promise<void> {
    const handle = this.open(documentId)
    await handle.synced
    applyFileContent(handle.yText, content)
  }

  close(documentId: string): void {
    const stored = this.docs.get(documentId)
    if (!stored) return

    clearTimeout(stored.syncTimer)
    stored.handle.provider.destroy()
    stored.handle.ydoc.destroy()
    this.docs.delete(documentId)
  }

  destroy(): void {
    for (const documentId of this.docs.keys()) {
      this.close(documentId)
    }
  }
}
