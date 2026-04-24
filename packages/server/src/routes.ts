import type { Extension } from '@hocuspocus/server'

export interface DocumentsRouteState {
  documentIds: Set<string>
  getPersistedDocumentIds?: () => Iterable<string>
}

export function createDocumentsRouteExtension(state: DocumentsRouteState = { documentIds: new Set() }): Extension {
  return {
    extensionName: 'AccordKitDocumentsRoute',

    async onCreateDocument({ documentName }) {
      state.documentIds.add(documentName)
    },

    async onStoreDocument({ documentName }) {
      state.documentIds.add(documentName)
    },

    async onRequest({ request, response }) {
      if (request.method !== 'GET' || request.url !== '/documents') return

      const documentIds = new Set([...state.documentIds].filter(isUserDocumentId))
      for (const documentId of state.getPersistedDocumentIds?.() ?? []) {
        if (isUserDocumentId(documentId)) documentIds.add(documentId)
      }

      const body = JSON.stringify([...documentIds].sort())
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      })
      response.end(body)

      throw undefined
    },
  }
}

function isUserDocumentId(documentId: string): boolean {
  return !documentId.startsWith('__accord_')
}
