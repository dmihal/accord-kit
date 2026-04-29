import { type KeyStore } from './key-store.js'

export interface AuthContext {
  identityId: string
  userName: string
  vaultId: string
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export function createKeyVerifier(store: KeyStore) {
  return {
    /**
     * Authenticate a raw key against a vault.
     * `vaultNameOrId` can be either the vault name or the vault ID.
     */
    authenticate(rawKey: string, vaultNameOrId: string): AuthContext {
      const identity = store.getIdentityByKey(rawKey)
      if (!identity || identity.revokedAt) {
        throw new AuthError('invalid key')
      }

      // Resolve vault name to ID if needed.
      let vaultId = vaultNameOrId
      const byName = store.getVaultByName(vaultNameOrId)
      if (byName) vaultId = byName.id

      if (!store.hasVaultAccess(identity.id, vaultId)) {
        throw new AuthError('forbidden')
      }

      return { identityId: identity.id, userName: identity.name, vaultId }
    },
  }
}
