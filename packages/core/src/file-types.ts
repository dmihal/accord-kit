import { normalizeDocumentId } from './paths.js'

const BINARY_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.zip',
])

export function getLowercaseExtension(documentId: string): string {
  const filename = normalizeDocumentId(documentId).split('/').at(-1) ?? ''
  const dotIndex = filename.lastIndexOf('.')

  if (dotIndex <= 0) return ''
  return filename.slice(dotIndex).toLowerCase()
}

export function isBinaryPath(documentId: string): boolean {
  return BINARY_EXTENSIONS.has(getLowercaseExtension(documentId))
}

export function isTextPath(documentId: string): boolean {
  return !isBinaryPath(documentId)
}
