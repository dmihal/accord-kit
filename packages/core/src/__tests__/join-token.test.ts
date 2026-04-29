import { describe, expect, it } from 'vitest'
import { decodeJoinToken, encodeJoinToken } from '../join-token.js'

describe('join token helpers', () => {
  it('round-trips a secure token', () => {
    const encoded = encodeJoinToken({
      serverUrl: 'wss://sync.example.com:1234',
      vaultId: 'team-notes',
      inviteCode: 'accord_inv_abc',
    })

    expect(encoded).toBe('accord://sync.example.com:1234/team-notes?invite=accord_inv_abc')
    expect(decodeJoinToken(encoded)).toEqual({
      serverUrl: 'wss://sync.example.com:1234',
      vaultId: 'team-notes',
      inviteCode: 'accord_inv_abc',
    })
  })

  it('encodes and decodes an insecure token with tls=0', () => {
    const encoded = encodeJoinToken({
      serverUrl: 'ws://localhost:1234',
      vaultId: 'dev',
      inviteCode: 'accord_inv_local',
    })

    expect(encoded).toBe('accord://localhost:1234/dev?invite=accord_inv_local&tls=0')
    expect(decodeJoinToken(encoded)).toEqual({
      serverUrl: 'ws://localhost:1234',
      vaultId: 'dev',
      inviteCode: 'accord_inv_local',
    })
  })

  it('rejects invalid schemes', () => {
    expect(() => decodeJoinToken('https://example.com/dev?invite=accord_inv_abc')).toThrow(/scheme/i)
  })

  it('rejects unsupported tls flag values', () => {
    expect(() => decodeJoinToken('accord://example.com/dev?invite=accord_inv_abc&tls=2')).toThrow(/tls flag/i)
  })

  it('rejects server URLs with paths', () => {
    expect(() => encodeJoinToken({
      serverUrl: 'wss://example.com/accord',
      vaultId: 'dev',
      inviteCode: 'accord_inv_abc',
    })).toThrow(/without a path/i)
  })
})
