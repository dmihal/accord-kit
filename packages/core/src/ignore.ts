import ignore from 'ignore'
import { normalizeDocumentId } from './paths.js'

export const DEFAULT_IGNORE_PATTERNS = [
  '.git/',
  '.obsidian/',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
  '.accord-trash/',
] as const

export const REQUIRED_IGNORE_PATTERNS = ['.accord-trash/'] as const

export interface IgnoreMatcher {
  ignores: (documentId: string) => boolean
}

export function createIgnoreMatcher(patterns: readonly string[] = []): IgnoreMatcher {
  const matcher = ignore().add([...DEFAULT_IGNORE_PATTERNS, ...patterns, ...REQUIRED_IGNORE_PATTERNS])

  return {
    ignores(documentId: string): boolean {
      const normalized = normalizeDocumentId(documentId)
      return matcher.ignores(normalized) || matcher.ignores(`${normalized}/`)
    },
  }
}
