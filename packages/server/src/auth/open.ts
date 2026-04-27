import type { IncomingMessage } from 'node:http'
import type { AccordConnectionContext, AuthenticatedRequest } from './types.js'

export function authenticateOpenRequest(request: Request | IncomingMessage, vaultId: string): AuthenticatedRequest {
  const url = 'url' in request ? new URL(request.url ?? '/', 'http://localhost') : new URL('/', 'http://localhost')
  const userName = url.searchParams.get('user') ?? 'anon'

  return {
    vaultId,
    userId: userName,
    userName,
    claims: {
      sub: userName,
      name: userName,
      vaults: [vaultId],
    },
  }
}

export function applyAuthenticatedContext(context: AccordConnectionContext, authenticated: AuthenticatedRequest): void {
  context.vaultId = authenticated.vaultId
  context.userId = authenticated.userId
  context.userName = authenticated.userName
  context.claims = authenticated.claims
}
