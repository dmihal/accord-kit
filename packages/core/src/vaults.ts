export const VAULT_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

const INTERNAL_DOCUMENT_PREFIX = '__accord_vault__'

export function isValidVaultId(value: string): boolean {
  return VAULT_ID_RE.test(value)
}

export function assertVaultId(value: string): string {
  if (!isValidVaultId(value)) {
    throw new Error(`Invalid vault ID "${value}"`)
  }

  return value
}

export function toVaultDocumentName(vaultId: string, documentId: string): string {
  return `${INTERNAL_DOCUMENT_PREFIX}/${assertVaultId(vaultId)}/${Buffer.from(documentId, 'utf8').toString('base64url')}`
}

export function fromVaultDocumentName(value: string): { vaultId: string; documentId: string } | null {
  if (!value.startsWith(`${INTERNAL_DOCUMENT_PREFIX}/`)) return null

  const [, vaultId, encodedDocumentId] = value.split('/')
  if (!vaultId || !encodedDocumentId || !isValidVaultId(vaultId)) return null

  try {
    return {
      vaultId,
      documentId: Buffer.from(encodedDocumentId, 'base64url').toString('utf8'),
    }
  } catch {
    return null
  }
}
