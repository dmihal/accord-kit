import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Extension } from '@hocuspocus/server'
import { AccordAuth, HttpError } from './auth/index.js'
import { AuthError } from './auth/key.js'
import { RedeemError, type KeyStore } from './auth/key-store.js'
import { parseVaultPathname } from './routing.js'
import type { StorageDriver } from './storage/index.js'

export function createDocumentsRouteExtension(options: {
  auth: AccordAuth
  storage: StorageDriver
}): Extension {
  return {
    extensionName: 'AccordKitDocumentsRoute',

    async onRequest({ request, response }) {
      try {
        await handleRequest(request, response, options.auth, options.storage)
      } catch (error) {
        if (error instanceof HttpError) {
          writeJson(response, error.statusCode, { error: error.message })
          throw undefined
        }

        throw error
      }
    },
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: AccordAuth,
  storage: StorageDriver,
): Promise<void> {
  const { vaultId, route } = parseVaultPathname(request.url ?? '/')

  if (request.method === 'GET' && route === '/vaults') {
    const vaults = await auth.listAccessibleVaults(request)
    writeJson(response, 200, vaults)
    throw undefined
  }

  if (request.method === 'GET' && (route === '/documents' || (route === '/' && request.url === '/documents'))) {
    const authenticated = await auth.authenticateHttp({ request, vaultId: vaultId ?? undefined })
    const documentIds = (await storage.listDocuments(authenticated.vaultId)).filter(isUserDocumentId)
    writeJson(response, 200, documentIds)
    throw undefined
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(encoded),
  })
  response.end(encoded)
}

function isUserDocumentId(documentId: string): boolean {
  return !documentId.startsWith('__accord_')
}

export function createIdentityRouteExtension(store: KeyStore): Extension {
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
        await handleIdentityRequest(store, method, path, request, response, corsHeaders)
      } catch (error) {
        if (error === undefined) throw error

        if (error instanceof ApiError) {
          sendJson(response, error.status, { error: error.message }, corsHeaders)
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
  method: string,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  corsHeaders: Record<string, string>,
): Promise<void> {
  if (method === 'POST' && path === '/auth/redeem') {
    const { code, name } = await readJsonBody<{ code: string; name: string }>(request)
    if (!code || typeof code !== 'string') throw new ApiError(400, 'code required')
    if (name !== undefined && typeof name !== 'string') throw new ApiError(400, 'name must be a string')

    const existingKey = extractBearerToken(request.headers.authorization)

    try {
      const result = store.redeemInvite(code, name ?? 'unnamed', existingKey)
      sendJson(response, 200, result, corsHeaders)
    } catch (error) {
      if (error instanceof RedeemError) throw new ApiError(400, error.message)
      throw error
    }
    return
  }

  if (method === 'GET' && path === '/auth/whoami') {
    const identity = requireAuth(store, request)
    const vaults = store.listVaultsForIdentity(identity.identityId)
    sendJson(response, 200, {
      identityId: identity.identityId,
      name: store.getIdentityById(identity.identityId)?.name ?? '',
      vaults: vaults.map((vault) => ({ id: vault.id, name: vault.name })),
    }, corsHeaders)
    return
  }

  if (method === 'POST' && path === '/vaults') {
    const auth = requireAuth(store, request)
    const { name } = await readJsonBody<{ name: string }>(request)
    if (!name || typeof name !== 'string') throw new ApiError(400, 'name required')

    const vault = store.createVault(name, auth.identityId)
    store.grantVaultAccess(auth.identityId, vault.id, auth.identityId)
    sendJson(response, 200, { vaultId: vault.id, name: vault.name }, corsHeaders)
    return
  }

  const vaultMatch = path.match(/^\/vaults\/([^/]+)(\/.*)?$/)
  if (vaultMatch) {
    const vaultId = decodeURIComponent(vaultMatch[1] ?? '')
    const subRoute = vaultMatch[2] ?? ''
    const auth = requireAuth(store, request)
    const members = store.listMembers(vaultId)

    if (!members.some((member) => member.identityId === auth.identityId)) throw new ApiError(403, 'Forbidden')

    if (method === 'POST' && subRoute === '/invites') {
      const body = await readJsonBody<{ ttlDays?: number }>(request)
      const ttlDays = typeof body.ttlDays === 'number' ? body.ttlDays : 7
      const invite = store.createInvite(vaultId, auth.identityId, ttlDays)
      sendJson(response, 200, { code: invite.code, expiresAt: invite.expiresAt }, corsHeaders)
      return
    }

    if (method === 'GET' && subRoute === '/invites') {
      const invites = store.listInvites(vaultId)
      sendJson(response, 200, invites.map((invite) => ({
        code: invite.code,
        createdBy: invite.createdByName,
        expiresAt: invite.expiresAt,
        redeemedBy: invite.redeemedByName,
        redeemedAt: invite.redeemedAt,
      })), corsHeaders)
      return
    }

    const inviteMatch = subRoute.match(/^\/invites\/(.+)$/)
    if (method === 'DELETE' && inviteMatch) {
      const code = decodeURIComponent(inviteMatch[1] ?? '')
      store.deleteInvite(code)
      response.writeHead(204, corsHeaders)
      response.end()
      return
    }

    if (method === 'GET' && subRoute === '/members') {
      sendJson(response, 200, members, corsHeaders)
      return
    }

    const memberMatch = subRoute.match(/^\/members\/(.+)$/)
    if (method === 'DELETE' && memberMatch) {
      const memberId = decodeURIComponent(memberMatch[1] ?? '')
      store.revokeVaultAccess(memberId, vaultId)
      response.writeHead(204, corsHeaders)
      response.end()
      return
    }

    throw new ApiError(404, 'Not found')
  }

  if (path === '/identities' || path.startsWith('/identities/')) {
    const auth = requireAuth(store, request)
    const identity = store.getIdentityById(auth.identityId)
    if (!identity?.isAdmin) throw new ApiError(403, 'Admin only')

    if (method === 'GET' && path === '/identities') {
      const all = store.listIdentities()
      sendJson(response, 200, all.map((item) => ({
        id: item.id,
        name: item.name,
        isAdmin: item.isAdmin,
        createdAt: item.createdAt,
        revokedAt: item.revokedAt,
        vaults: store.listVaultsForIdentity(item.id).map((vault) => ({ id: vault.id, name: vault.name })),
      })), corsHeaders)
      return
    }

    const identityMatch = path.match(/^\/identities\/(.+)$/)
    if (method === 'DELETE' && identityMatch) {
      const targetId = decodeURIComponent(identityMatch[1] ?? '')
      store.revokeIdentity(targetId)
      response.writeHead(204, corsHeaders)
      response.end()
      return
    }

    throw new ApiError(404, 'Not found')
  }
}

function requireAuth(
  store: KeyStore,
  request: IncomingMessage,
): { identityId: string; userName: string; vaultId: string } {
  const key = extractBearerToken(request.headers.authorization)
  if (!key) throw new ApiError(401, 'Authorization required')

  try {
    const identity = store.getIdentityByKey(key)
    if (!identity || identity.revokedAt) throw new AuthError('invalid key')
    return { identityId: identity.id, userName: identity.name, vaultId: '' }
  } catch (error) {
    if (error instanceof AuthError) throw new ApiError(401, error.message)
    throw error
  }
}

function extractBearerToken(headerValue: string | string[] | undefined): string | null {
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!value) return null

  const match = value.match(/^Bearer (.+)$/i)
  return match?.[1] ?? null
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
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
