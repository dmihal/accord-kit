import { assertVaultId } from './vaults.js'

export interface DecodedJoinToken {
  serverUrl: string
  vaultId: string
  inviteCode: string
}

export function encodeJoinToken(input: DecodedJoinToken): string {
  const inviteCode = input.inviteCode.trim()
  if (!inviteCode) {
    throw new Error('Invite code is required')
  }

  const vaultId = assertVaultId(input.vaultId)
  const serverUrl = normalizeServerUrl(input.serverUrl)
  const parsed = new URL(serverUrl)
  const token = new URL(`accord://${parsed.host}/${encodeURIComponent(vaultId)}`)
  token.searchParams.set('invite', inviteCode)

  if (parsed.protocol === 'ws:') {
    token.searchParams.set('tls', '0')
  }

  return token.toString()
}

export function decodeJoinToken(value: string): DecodedJoinToken {
  const token = new URL(value)
  if (token.protocol !== 'accord:') {
    throw new Error(`Invalid join token scheme "${token.protocol}"`)
  }
  if (!token.hostname) {
    throw new Error('Join token host is required')
  }

  const vaultId = assertVaultId(decodeURIComponent(token.pathname.replace(/^\/+/, '')))
  const inviteCode = token.searchParams.get('invite')?.trim()
  if (!inviteCode) {
    throw new Error('Join token invite code is required')
  }

  const tls = token.searchParams.get('tls')
  if (tls !== null && tls !== '0' && tls !== '1') {
    throw new Error(`Invalid tls flag "${tls}"`)
  }

  const serverUrl = `${tls === '0' ? 'ws' : 'wss'}://${token.host}`
  return {
    serverUrl,
    vaultId,
    inviteCode,
  }
}

function normalizeServerUrl(value: string): string {
  const parsed = new URL(value)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Join tokens only support server origins without a path, query, or hash')
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'ws:') {
    return `ws://${parsed.host}`
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'wss:') {
    return `wss://${parsed.host}`
  }

  throw new Error(`Unsupported server URL scheme "${parsed.protocol}"`)
}
