import { assertVaultId, isValidVaultId } from './vaults.js'

export interface ParsedVaultPath {
  vaultId: string | null
  route: string
}

export function parseVaultPathname(pathname: string): ParsedVaultPath {
  if (pathname === '/vaults') {
    return { vaultId: null, route: '/vaults' }
  }

  const match = pathname.match(/^\/vaults\/([^/]+)(\/.*)?$/)
  if (match) {
    return {
      vaultId: decodeURIComponent(match[1] ?? ''),
      route: match[2] || '/',
    }
  }

  return { vaultId: null, route: pathname || '/' }
}

export function resolveVaultReferenceFromUrl(value: string | URL): string | null {
  const url = value instanceof URL ? value : toAbsoluteUrl(value)
  const parsed = parseVaultPathname(url.pathname)

  if (parsed.vaultId) return parsed.vaultId

  const queryVault = url.searchParams.get('vault')?.trim()
  if (queryVault) return queryVault

  return null
}

export function resolveVaultIdFromUrl(value: string | URL): string | null {
  const reference = resolveVaultReferenceFromUrl(value)
  return reference ? assertVaultId(reference) : null
}

export function resolveVaultIdFromPathname(pathname: string): string | null {
  return resolveVaultIdFromUrl(toAbsoluteUrl(pathname))
}

export function isValidRequestedVaultId(value: string | null): value is string {
  return typeof value === 'string' && isValidVaultId(value)
}

export function toAbsoluteUrl(value: string): URL {
  return new URL(value, 'http://localhost')
}
