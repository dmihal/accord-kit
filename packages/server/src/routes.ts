import type { Extension } from '@hocuspocus/server'

export interface DocumentsRouteState {
  documentIds: Set<string>
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

      const body = JSON.stringify([...state.documentIds].sort())
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      })
      response.end(body)

      throw undefined
    },
  }
}
