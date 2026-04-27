import type { Extension } from '@hocuspocus/server'
import * as Y from 'yjs'
import type { AccordServerConfig } from '../config.js'
import type { AccordConnectionContext } from '../auth/index.js'
import { PostgresDriver } from './postgres-driver.js'
import { SQLiteDriver } from './sqlite-driver.js'
import { fromVaultDocumentName } from '../vaults.js'

export interface StorageDriver {
  setup(): Promise<void>
  destroy(): Promise<void>
  createVault(vaultId: string): Promise<void>
  hasVault(vaultId: string): Promise<boolean>
  listVaults(): Promise<string[]>
  listDocuments(vaultId: string): Promise<string[]>
  loadDocument(vaultId: string, documentId: string): Promise<{ state: Uint8Array | null; updates: Uint8Array[] }>
  appendUpdate(vaultId: string, documentId: string, update: Uint8Array): Promise<void>
  storeDocument(vaultId: string, documentId: string, state: Uint8Array): Promise<void>
}

export function createStorageDriver(config: AccordServerConfig['storage']): StorageDriver {
  return config.driver === 'postgres' ? new PostgresDriver(config.postgres) : new SQLiteDriver(config.sqlite.path)
}

export { PostgresDriver, SQLiteDriver }

export function createAccordStorageExtension(driver: StorageDriver): Extension<AccordConnectionContext> {
  return {
    extensionName: 'AccordKitStorage',

    async onLoadDocument({ documentName, document, context }) {
      const scoped = resolveScopedDocument(documentName, context)
      const loaded = await driver.loadDocument(scoped.vaultId, scoped.documentId)

      if (loaded.state) {
        Y.applyUpdate(document, loaded.state)
      }

      for (const update of loaded.updates) {
        Y.applyUpdate(document, update)
      }
    },

    async onChange({ documentName, update, context }) {
      const scoped = resolveScopedDocument(documentName, context)
      await driver.appendUpdate(scoped.vaultId, scoped.documentId, update)
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      const scoped = resolveScopedDocument(documentName, lastContext)
      await driver.storeDocument(scoped.vaultId, scoped.documentId, Y.encodeStateAsUpdate(document))
    },
  }
}

function resolveScopedDocument(documentName: string, context: AccordConnectionContext): { vaultId: string; documentId: string } {
  const decoded = fromVaultDocumentName(documentName)
  if (decoded) {
    return decoded
  }

  if (!context.vaultId) {
    throw new Error(`Missing vault context for document "${documentName}"`)
  }

  return {
    vaultId: context.vaultId,
    documentId: documentName,
  }
}
