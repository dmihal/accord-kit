const VAULT_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

export function assertVaultId(value: string): string {
  if (!VAULT_ID_RE.test(value)) {
    throw new Error(`Invalid vault ID "${value}"`)
  }

  return value
}

export function isValidVaultId(value: string): boolean {
  return VAULT_ID_RE.test(value)
}

export function fromVaultDocumentName(value: string): { vaultId: string; documentId: string } | null {
  if (!value.startsWith('__accord_vault__/')) return null

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
