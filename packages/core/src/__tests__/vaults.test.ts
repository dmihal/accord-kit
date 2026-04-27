import { describe, expect, it } from 'vitest'
import { assertVaultId, fromVaultDocumentName, isValidVaultId, toVaultDocumentName } from '../vaults.js'

describe('vault helpers', () => {
  it('validates vault IDs', () => {
    expect(isValidVaultId('default')).toBe(true)
    expect(isValidVaultId('team-foo')).toBe(true)
    expect(isValidVaultId('1')).toBe(true)
    expect(isValidVaultId('Bad')).toBe(false)
    expect(isValidVaultId('-bad')).toBe(false)
  })

  it('encodes and decodes internal document names', () => {
    const encoded = toVaultDocumentName('team-foo', 'notes/hello.md')

    expect(fromVaultDocumentName(encoded)).toEqual({
      vaultId: 'team-foo',
      documentId: 'notes/hello.md',
    })
  })

  it('rejects invalid vault IDs', () => {
    expect(() => assertVaultId('Bad')).toThrow(/Invalid vault ID/)
  })
})
