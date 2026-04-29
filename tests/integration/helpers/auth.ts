import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface MintTokenInput {
  sub: string
  vaults: string[]
  name?: string
  issuer?: string
  audience?: string
  issuedAt?: number
  expiresAt?: number
}

export async function createJwtTestKeys(): Promise<{
  publicKeyPath: string
  mintToken: (input: MintTokenInput) => string
}> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  const dir = await mkdtemp(path.join(tmpdir(), 'accord-jwt-'))
  const publicKeyPath = path.join(dir, 'jwt-test.pub.pem')
  await writeFile(publicKeyPath, publicKey.export({ format: 'pem', type: 'spki' }))

  return {
    publicKeyPath,
    mintToken: (input) => {
      const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000)
      const expiresAt = input.expiresAt ?? issuedAt + 3600
      const header = toBase64Url({
        alg: 'ES256',
        kid: 'test',
        typ: 'JWT',
      })
      const payload = toBase64Url({
        sub: input.sub,
        name: input.name,
        vaults: input.vaults,
        iss: input.issuer,
        aud: input.audience,
        iat: issuedAt,
        exp: expiresAt,
      })
      const signingInput = `${header}.${payload}`
      const signature = sign('SHA256', Buffer.from(signingInput), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url')

      return `${signingInput}.${signature}`
    },
  }
}

function toBase64Url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
