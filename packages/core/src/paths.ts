import path from 'node:path'

export class UnsafeDocumentPathError extends Error {
  constructor(documentId: string, reason: string) {
    super(`Unsafe document path "${documentId}": ${reason}`)
    this.name = 'UnsafeDocumentPathError'
  }
}

export function normalizeDocumentId(input: string): string {
  return input
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/')
}

export function assertSafeDocumentId(input: string): string {
  const slashNormalized = input.replaceAll('\\', '/')

  if (slashNormalized.startsWith('/')) {
    throw new UnsafeDocumentPathError(input, 'absolute paths are not allowed')
  }

  if (/^[A-Za-z]:\//.test(slashNormalized)) {
    throw new UnsafeDocumentPathError(input, 'drive-qualified paths are not allowed')
  }

  const documentId = normalizeDocumentId(input)

  if (documentId.length === 0) {
    throw new UnsafeDocumentPathError(input, 'empty paths are not allowed')
  }

  if (documentId.split('/').includes('..')) {
    throw new UnsafeDocumentPathError(input, 'parent traversal is not allowed')
  }

  return documentId
}

export function isSafeDocumentId(input: string): boolean {
  try {
    assertSafeDocumentId(input)
    return true
  } catch {
    return false
  }
}

export function toDocumentId(rootPath: string, filePath: string): string {
  const root = normalizeLocalPath(rootPath)
  const file = normalizeLocalPath(filePath)
  const rootPrefix = root.endsWith('/') ? root : `${root}/`

  if (file !== root && !file.startsWith(rootPrefix)) {
    throw new UnsafeDocumentPathError(filePath, `path is outside root "${rootPath}"`)
  }

  return assertSafeDocumentId(file.slice(rootPrefix.length))
}

export function resolveSafeStoragePath(storageRoot: string, documentId: string): string {
  const safeDocumentId = assertSafeDocumentId(documentId)
  const resolvedRoot = path.resolve(storageRoot)
  const resolvedPath = path.resolve(resolvedRoot, ...safeDocumentId.split('/'))
  const relative = path.relative(resolvedRoot, resolvedPath)

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new UnsafeDocumentPathError(documentId, 'resolved path escapes storage root')
  }

  return resolvedPath
}

function normalizeLocalPath(input: string): string {
  const normalized = normalizeDocumentId(input)

  if (/^[A-Za-z]:/.test(input)) {
    return input.replaceAll('\\', '/').replace(/\/+$/, '')
  }

  return normalized.replace(/\/+$/, '')
}
