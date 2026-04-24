import { describe, expect, it } from 'vitest'
import {
  assertSafeDocumentId,
  isSafeDocumentId,
  normalizeDocumentId,
  resolveSafeStoragePath,
  toDocumentId,
} from '../paths.js'

describe('paths', () => {
  it('normalizes Windows paths to forward-slash document IDs', () => {
    expect(normalizeDocumentId(String.raw`notes\meeting.md`)).toBe('notes/meeting.md')
    expect(toDocumentId(String.raw`C:\vault`, String.raw`C:\vault\notes\meeting.md`)).toBe('notes/meeting.md')
  })

  it('rejects absolute remote paths', () => {
    expect(() => assertSafeDocumentId('/notes/meeting.md')).toThrow(/absolute paths/)
    expect(() => assertSafeDocumentId(String.raw`C:\vault\secret.md`)).toThrow(/drive-qualified/)
  })

  it('rejects remote paths with parent traversal', () => {
    expect(() => assertSafeDocumentId('../secret.md')).toThrow(/parent traversal/)
    expect(() => assertSafeDocumentId('notes/../../secret.md')).toThrow(/parent traversal/)
    expect(isSafeDocumentId('notes/meeting.md')).toBe(true)
  })

  it('resolves storage paths inside the storage root', () => {
    const resolved = resolveSafeStoragePath('/tmp/accord-binary', 'images/diagram.png')
    expect(resolved).toBe('/tmp/accord-binary/images/diagram.png')
    expect(() => resolveSafeStoragePath('/tmp/accord-binary', '../escape.png')).toThrow(/parent traversal/)
  })
})
