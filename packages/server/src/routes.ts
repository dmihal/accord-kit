import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Extension } from '@hocuspocus/server'
import { RedeemError, type KeyStore } from './auth/key-store.js'
import { AuthError, createKeyVerifier } from './auth/key.js'

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

// --- Identity REST API ---

export function createIdentityRouteExtension(store: KeyStore): Extension {
  const verifier = createKeyVerifier(store)

  return {
    extensionName: 'AccordKitIdentityRoutes',

    async onRequest({ request, response }) {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname
      const method = request.method ?? 'GET'

      if (!path.startsWith('/auth/') && !path.startsWith('/vaults') && !path.startsWith('/identities')) return

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      }

      if (method === 'OPTIONS') {
        response.writeHead(204, corsHeaders)
        response.end()
        throw undefined
      }

      try {
        await handleIdentityRequest(store, verifier, method, path, request, response, corsHeaders)
      } catch (err) {
        if (err === undefined) throw err // propagate hocuspocus stop-signal
        if (err instanceof ApiError) {
          sendJson(response, err.status, { error: err.message }, corsHeaders)
        } else {
          sendJson(response, 500, { error: 'Internal server error' }, corsHeaders)
        }
      }

      throw undefined
    },
  }
}

async function handleIdentityRequest(
  store: KeyStore,
  verifier: ReturnType<typeof createKeyVerifier>,
  method: string,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  corsHeaders: Record<string, string>,
): Promise<void> {
  // POST /auth/redeem
  if (method === 'POST' && path === '/auth/redeem') {
    const { code, name } = await readJsonBody<{ code: string; name: string }>(request)
    if (!code || typeof code !== 'string') throw new ApiError(400, 'code required')
    if (name !== undefined && typeof name !== 'string') throw new ApiError(400, 'name must be a string')

    // If the caller presents an existing key, add vault access to that identity
    // instead of creating a new one (multi-vault onboarding path).
    const authHeader = request.headers['authorization'] ?? ''
    const existingKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    try {
      const result = store.redeemInvite(code, name ?? 'unnamed', existingKey)
      sendJson(response, 200, result, corsHeaders)
    } catch (err) {
      if (err instanceof RedeemError) throw new ApiError(400, err.message)
      throw err
    }
    return
  }

  // GET /auth/whoami
  if (method === 'GET' && path === '/auth/whoami') {
    const identity = requireAuth(store, verifier, request)
    const vaults = store.listVaultsForIdentity(identity.identityId)
    sendJson(response, 200, {
      identityId: identity.identityId,
      name: store.getIdentityById(identity.identityId)?.name ?? '',
      vaults: vaults.map(v => ({ id: v.id, name: v.name })),
    }, corsHeaders)
    return
  }

  // POST /vaults
  if (method === 'POST' && path === '/vaults') {
    const auth = requireAuth(store, verifier, request)
    const { name } = await readJsonBody<{ name: string }>(request)
    if (!name || typeof name !== 'string') throw new ApiError(400, 'name required')
    const vault = store.createVault(name, auth.identityId)
    store.grantVaultAccess(auth.identityId, vault.id, auth.identityId)
    sendJson(response, 200, { vaultId: vault.id, name: vault.name }, corsHeaders)
    return
  }

  // Vault-scoped routes: /vaults/<vaultId>/...
  const vaultMatch = path.match(/^\/vaults\/([^/]+)(\/.*)?$/)
  if (vaultMatch) {
    const vaultId = decodeURIComponent(vaultMatch[1] ?? '')
    const sub = vaultMatch[2] ?? ''
    const auth = requireAuth(store, verifier, request)

    if (!store.hasVaultAccess(auth.identityId, vaultId)) throw new ApiError(403, 'Forbidden')

    // POST /vaults/<vaultId>/invites
    if (method === 'POST' && sub === '/invites') {
      const body = await readJsonBody<{ ttlDays?: number }>(request)
      const ttlDays = typeof body.ttlDays === 'number' ? body.ttlDays : 7
      const invite = store.createInvite(vaultId, auth.identityId, ttlDays)
      sendJson(response, 200, { code: invite.code, expiresAt: invite.expiresAt }, corsHeaders)
      return
    }

    // GET /vaults/<vaultId>/invites
    if (method === 'GET' && sub === '/invites') {
      const invites = store.listInvites(vaultId)
      sendJson(response, 200, invites.map(i => ({
        code: i.code,
        createdBy: i.createdByName,
        expiresAt: i.expiresAt,
        redeemedBy: i.redeemedByName,
        redeemedAt: i.redeemedAt,
      })), corsHeaders)
      return
    }

    // DELETE /vaults/<vaultId>/invites/<code>
    const inviteMatch = sub.match(/^\/invites\/(.+)$/)
    if (method === 'DELETE' && inviteMatch) {
      const code = decodeURIComponent(inviteMatch[1] ?? '')
      store.deleteInvite(code)
      response.writeHead(204, corsHeaders)
      response.end()
      return
    }

    // GET /vaults/<vaultId>/members
    if (method === 'GET' && sub === '/members') {
      const members = store.listMembers(vaultId)
      sendJson(response, 200, members, corsHeaders)
      return
    }

    // DELETE /vaults/<vaultId>/members/<id>
    const memberMatch = sub.match(/^\/members\/(.+)$/)
    if (method === 'DELETE' && memberMatch) {
      const memberId = decodeURIComponent(memberMatch[1] ?? '')
      store.revokeVaultAccess(memberId, vaultId)
      response.writeHead(204, corsHeaders)
      response.end()
      return
    }

    throw new ApiError(404, 'Not found')
  }

  // Identity management (admin only)
  if (path === '/identities' || path.startsWith('/identities/')) {
    const auth = requireAuth(store, verifier, request)
    const identity = store.getIdentityById(auth.identityId)
    if (!identity?.isAdmin) throw new ApiError(403, 'Admin only')

    if (method === 'GET' && path === '/identities') {
      const all = store.listIdentities()
      sendJson(response, 200, all.map(i => ({
        id: i.id,
        name: i.name,
        isAdmin: i.isAdmin,
        createdAt: i.createdAt,
        revokedAt: i.revokedAt,
        vaults: store.listVaultsForIdentity(i.id).map(v => ({ id: v.id, name: v.name })),
      })), corsHeaders)
      return
    }

    const idMatch = path.match(/^\/identities\/(.+)$/)
    if (method === 'DELETE' && idMatch) {
      const targetId = decodeURIComponent(idMatch[1] ?? '')
      store.revokeIdentity(targetId)
      response.writeHead(204, corsHeaders)
      response.end()
      return
    }

    throw new ApiError(404, 'Not found')
  }
}

// --- helpers ---

function requireAuth(
  store: KeyStore,
  verifier: ReturnType<typeof createKeyVerifier>,
  request: IncomingMessage,
): ReturnType<ReturnType<typeof createKeyVerifier>['authenticate']> {
  const authHeader = request.headers['authorization'] ?? ''
  const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!key) throw new ApiError(401, 'Authorization required')

  try {
    // For HTTP endpoints, we don't enforce a specific vault in the key check —
    // vault access is checked per-operation above.
    const identity = store.getIdentityByKey(key)
    if (!identity || identity.revokedAt) throw new AuthError('invalid key')
    return { identityId: identity.id, userName: identity.name, vaultId: '' }
  } catch (err) {
    if (err instanceof AuthError) throw new ApiError(401, err.message)
    throw err
  }
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', chunk => { body += String(chunk) })
    request.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as T) : ({} as T))
      } catch {
        reject(new ApiError(400, 'Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response: ServerResponse, status: number, data: unknown, extraHeaders: Record<string, string> = {}): void {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  })
  response.end(body)
}

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}
