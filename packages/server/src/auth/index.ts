import type { IncomingMessage } from 'node:http'
import type { AccordServerConfig } from '../config.js'
import { resolveVaultIdFromUrl, resolveVaultReferenceFromUrl, toAbsoluteUrl } from '../routing.js'
import type { StorageDriver } from '../storage/index.js'
import { AuthError, createKeyVerifier } from './key.js'
import type { KeyStore } from './key-store.js'
import { applyAuthenticatedContext, authenticateOpenRequest } from './open.js'
import { JwtVerifier } from './jwt.js'
import type { AuthenticatedRequest, AccordConnectionContext } from './types.js'

export class AccordAuth {
  private readonly jwtVerifier: JwtVerifier | null
  private readonly keyVerifier: ReturnType<typeof createKeyVerifier> | null

  constructor(
    private readonly config: AccordServerConfig['auth'],
    private readonly storage: StorageDriver,
    private readonly keyStore?: KeyStore,
  ) {
    this.jwtVerifier = config.mode === 'jwt'
      ? new JwtVerifier(config.jwt.publicKeys, config.jwt.issuer, config.jwt.audience)
      : null
    this.keyVerifier = config.mode === 'key'
      ? createKeyVerifier(assertKeyStore(keyStore))
      : null
  }

  async authenticateWebSocket(input: {
    request: Request
    context: AccordConnectionContext
    token: string
  }): Promise<AuthenticatedRequest> {
    const url = toAbsoluteUrl(input.request.url)

    const authenticated = this.config.mode === 'open'
      ? authenticateOpenRequest(input.request, resolveRequiredVaultId(url, true))
      : this.config.mode === 'jwt'
        ? this.authenticateJwt(input.token, resolveRequiredVaultId(url, false))
        : this.authenticateKey(input.token, resolveRequiredVaultReference(url))

    await this.assertVaultExists(authenticated.vaultId)
    applyAuthenticatedContext(input.context, authenticated)
    return authenticated
  }

  async authenticateHttp(input: {
    request: IncomingMessage
    vaultId?: string
  }): Promise<AuthenticatedRequest> {
    if (this.config.mode === 'open') {
      const vaultId = input.vaultId ?? resolveVaultIdFromUrl(toAbsoluteUrl(input.request.url ?? '/'), true)
      if (!vaultId) throw new HttpError(404, 'not found')
      await this.assertVaultExists(vaultId)
      return authenticateOpenRequest(input.request, vaultId)
    }

    const token = extractBearerToken(input.request.headers.authorization)
    if (!token) throw new HttpError(401, 'missing bearer token')

    if (this.config.mode === 'jwt') {
      const vaultId = input.vaultId ?? resolveVaultIdFromUrl(toAbsoluteUrl(input.request.url ?? '/'), false)
      if (!vaultId) throw new HttpError(404, 'not found')
      await this.assertVaultExists(vaultId)
      return this.authenticateJwt(token, vaultId)
    }

    const requestedVault = input.vaultId ?? resolveVaultReferenceFromUrl(toAbsoluteUrl(input.request.url ?? '/'), false)
    if (!requestedVault) throw new HttpError(404, 'not found')
    const authenticated = this.authenticateKey(token, requestedVault)
    await this.assertVaultExists(authenticated.vaultId)
    return authenticated
  }

  async listAccessibleVaults(request: IncomingMessage): Promise<string[]> {
    if (this.config.mode === 'open') {
      return this.storage.listVaults()
    }

    const token = extractBearerToken(request.headers.authorization)
    if (!token) throw new HttpError(401, 'missing bearer token')

    if (this.config.mode === 'key') {
      const store = assertKeyStore(this.keyStore)
      const identity = store.getIdentityByKey(token)
      if (!identity || identity.revokedAt) throw new HttpError(401, 'invalid key')
      return store.listVaultsForIdentity(identity.id).map((vault) => vault.id)
    }

    try {
      const claims = this.jwtVerifier?.verify(token)
      const existingVaults = await this.storage.listVaults()
      return existingVaults.filter((vaultId) => claims?.vaults.includes(vaultId))
    } catch (error) {
      throw new HttpError(401, error instanceof Error ? error.message : 'invalid token')
    }
  }

  private authenticateJwt(token: string, vaultId: string): AuthenticatedRequest {
    let claims

    try {
      claims = this.jwtVerifier?.verify(token)
    } catch (error) {
      throw new HttpError(401, error instanceof Error ? error.message : 'invalid token')
    }

    if (!claims) throw new Error('jwt verifier unavailable')
    if (!claims.vaults.includes(vaultId)) throw new HttpError(403, 'forbidden')

    return {
      vaultId,
      userId: claims.sub,
      userName: claims.name ?? claims.sub,
      claims,
    }
  }

  private authenticateKey(token: string, requestedVault: string): AuthenticatedRequest {
    try {
      const authenticated = this.keyVerifier?.authenticate(token, requestedVault)
      if (!authenticated) throw new Error('key verifier unavailable')

      const vaults = this.keyStore?.listVaultsForIdentity(authenticated.identityId).map((vault) => vault.id) ?? [authenticated.vaultId]

      return {
        vaultId: authenticated.vaultId,
        userId: authenticated.identityId,
        userName: authenticated.userName,
        claims: {
          sub: authenticated.identityId,
          name: authenticated.userName,
          vaults,
        },
      }
    } catch (error) {
      if (error instanceof AuthError) {
        throw new HttpError(error.message === 'forbidden' ? 403 : 401, error.message)
      }

      throw error
    }
  }

  private async assertVaultExists(vaultId: string): Promise<void> {
    if (!(await this.storage.hasVault(vaultId))) {
      throw new HttpError(404, 'unknown vault')
    }
  }
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

export function extractBearerToken(headerValue: string | string[] | undefined): string | null {
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!value) return null

  const match = value.match(/^Bearer (.+)$/i)
  return match?.[1] ?? null
}

function resolveRequiredVaultId(url: URL, allowImplicitDefault: boolean): string {
  const vaultId = resolveVaultIdFromUrl(url, allowImplicitDefault)
  if (!vaultId) throw new Error('invalid vault')
  return vaultId
}

function resolveRequiredVaultReference(url: URL): string {
  const vault = resolveVaultReferenceFromUrl(url, false)
  if (!vault) throw new Error('invalid vault')
  return vault
}

function assertKeyStore(keyStore: KeyStore | undefined): KeyStore {
  if (!keyStore) {
    throw new Error('auth.mode=key requires a key store')
  }

  return keyStore
}

export type { AccordConnectionContext, AuthenticatedRequest, JwtClaims } from './types.js'
