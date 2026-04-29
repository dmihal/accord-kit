import { createPublicKey, createVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { JwtPublicKeyConfig } from '../config.js'
import type { JwtClaims } from './types.js'

interface LoadedPublicKey extends JwtPublicKeyConfig {
  key: ReturnType<typeof createPublicKey>
}

interface JwtHeader {
  alg?: string
  kid?: string
}

export class JwtVerifier {
  private readonly keys: LoadedPublicKey[]

  constructor(
    keyConfigs: JwtPublicKeyConfig[],
    private readonly issuer?: string,
    private readonly audience?: string,
  ) {
    if (keyConfigs.length === 0) {
      throw new Error('JWT auth requires at least one public key')
    }

    this.keys = keyConfigs.map((keyConfig) => ({
      ...keyConfig,
      key: createPublicKey(readFileSync(keyConfig.publicKeyPath, 'utf8')),
    }))
  }

  verify(token: string): JwtClaims {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('invalid token')

    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]
    const header = parseJwtPart<JwtHeader>(encodedHeader)
    const claims = parseJwtPart<JwtClaims>(encodedPayload)
    const signature = Buffer.from(encodedSignature, 'base64url')
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`)
    const key = this.selectKey(header)

    if (header.alg !== key.algorithm) {
      throw new Error('invalid token algorithm')
    }

    const verified = createVerify('SHA256').update(signingInput).verify(
      {
        key: key.key,
        dsaEncoding: key.algorithm === 'ES256' ? 'ieee-p1363' : undefined,
      },
      signature,
    )

    if (!verified) throw new Error('invalid token signature')
    validateClaims(claims, this.issuer, this.audience)
    return claims
  }

  private selectKey(header: JwtHeader): LoadedPublicKey {
    if (header.kid) {
      const key = this.keys.find((candidate) => candidate.kid === header.kid)
      if (!key) throw new Error('unknown token key')
      return key
    }

    if (this.keys.length !== 1) {
      throw new Error('token key id required')
    }

    const [key] = this.keys
    if (!key) {
      throw new Error('jwt verifier has no keys')
    }

    return key
  }
}

function validateClaims(claims: JwtClaims, issuer?: string, audience?: string): void {
  const now = Math.floor(Date.now() / 1000)

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('invalid token subject')
  }

  if (!Array.isArray(claims.vaults)) {
    throw new Error('invalid token vault claim')
  }

  if (typeof claims.exp === 'number' && claims.exp <= now) {
    throw new Error('token expired')
  }

  if (issuer && claims.iss !== issuer) {
    throw new Error('invalid token issuer')
  }

  if (audience) {
    const aud = claims.aud
    const matchesAudience = Array.isArray(aud) ? aud.includes(audience) : aud === audience
    if (!matchesAudience) throw new Error('invalid token audience')
  }
}

function parseJwtPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
}
