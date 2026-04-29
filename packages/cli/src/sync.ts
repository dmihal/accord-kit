import { applyFileContent, toVaultDocumentName } from '@accord-kit/core'
import { HocuspocusProvider } from '@hocuspocus/provider'
import NodeWebSocket from 'ws'
import * as Y from 'yjs'

export function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 70%, 50%)`
}

export interface DocPoolConfig {
  serverUrl: string
  userName: string
  vaultId: string
  token?: string
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
  settled: boolean
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
    const settleError = (error: Error) => {
      const stored = this.docs.get(documentId)
      if (!stored || stored.settled) return
      stored.settled = true
      clearTimeout(stored.syncTimer)
      rejectSynced(error)
    }
    const settleSynced = () => {
      const stored = this.docs.get(documentId)
      if (!stored || stored.settled) return
      stored.settled = true
      clearTimeout(stored.syncTimer)
      resolveSynced()
    }
    const syncTimer = setTimeout(() => {
      settleError(new Error(`Timed out syncing "${documentId}"`))
    }, this.syncTimeoutMs)

    const provider = new HocuspocusProvider({
      url: buildVaultWebSocketUrl(this.config.serverUrl, this.config.vaultId, this.config.userName),
      name: toVaultDocumentName(this.config.vaultId, documentId),
      document: ydoc,
      token: this.config.token,
      WebSocketPolyfill: NodeWebSocket as unknown as typeof WebSocket,
      onSynced: ({ state }: { state: boolean }) => {
        if (!state) return
        settleSynced()
      },
      onAuthenticationFailed: ({ reason }: { reason: string }) => {
        settleError(new Error(`Authentication failed syncing "${documentId}": ${reason}`))
      },
      onClose: ({ event }: { event?: { code: number; reason: string } }) => {
        if (!event || event.code === 1000 || event.code === 1005) return
        const suffix = event.reason ? `: ${event.reason}` : ''
        settleError(new Error(`Connection closed before sync for "${documentId}" (${event.code}${suffix})`))
      },
    } as any)

    provider.setAwarenessField('user', {
      name: this.config.userName,
      color: stringToColor(this.config.userName),
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
      settled: false,
    })

    return handle
  }

  async applyContent(documentId: string, content: string): Promise<void> {
    const handle = this.open(documentId)
    await handle.synced
    if (!handle.ydoc.getMap('metadata').get('exists')) {
      handle.ydoc.getMap('metadata').set('exists', true)
    }
    applyFileContent(handle.yText, content)
  }

  getProvider(documentId: string): HocuspocusProvider | undefined {
    return this.docs.get(documentId)?.handle.provider
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

function buildVaultWebSocketUrl(baseUrl: string, vaultId: string, userName: string): string {
  const url = new URL(baseUrl)
  url.pathname = `/vaults/${encodeURIComponent(vaultId)}`
  url.searchParams.set('user', userName)
  return url.toString()
}
